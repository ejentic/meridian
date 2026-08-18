import { getDb, inTransaction } from '../db/index';
import { isDirectReport, managerOf } from './authz';
import { conflict, forbidden, notFound, unprocessable } from './errors';
import { roundHalfUp } from './pricing';
import type { Principal } from './session';
import {
  COMPETENCIES,
  type Band,
  type Competency,
  type CycleStatus,
  type EvaluationEvent,
  type EvaluationStatus,
  type EvaluationType,
} from '../shared/types';

// MR-REV-01 through MR-REV-06.

// Declared in src/shared/types.ts, re-exported here so the interface and the server share
// one definition without the interface importing this module. COMPETENCIES is a value and
// not only a type, so it is imported and re-exported rather than aliased.
export { COMPETENCIES };
export type { Band, Competency, CycleStatus, EvaluationEvent, EvaluationStatus, EvaluationType };

/** MR-REV-03 guards. */
export const MINIMUM_COMMENT_LENGTH = 20;
export const MINIMUM_RETURN_REASON_LENGTH = 10;

/**
 * MR-REV-02. Because the input is four integers from 1 to 5, only 17 overall values are
 * reachable. Exported so a test can assert the set rather than restate it, since a test case
 * expecting 4.4 or 3.1 is testing a value the system cannot produce.
 */
export const REACHABLE_OVERALL_TENTHS = [
  10, 13, 15, 18, 20, 23, 25, 28, 30, 33, 35, 38, 40, 43, 45, 48, 50,
] as const;

/** MR-REV-01. An integer from 1 to 5 inclusive. Nothing else, including "4" and 3.5. */
export function isValidRating(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  // MR-REV-01: an integer from 1 to 5 inclusive. Without the integer check, 3.5 would be
  // stored and the overall score could leave MR-REV-02's 17 reachable values.
  if (!Number.isInteger(value)) return false;
  return value >= 1 && value <= 5;
}

/**
 * MR-REV-02. The sum of the four ratings divided by 4, rounded half-up to one decimal place,
 * returned in tenths so the value stays an integer.
 *
 * Null when any competency is unrated. Null is neither displayed as 0.0 nor treated as a
 * rating of zero in the mean, which is why this returns null rather than a number.
 */
export function overallTenths(ratings: readonly (number | null)[]): number | null {
  if (ratings.length !== COMPETENCIES.length) return null;
  if (ratings.some((r) => r === null)) return null;
  const sum = (ratings as number[]).reduce((a, b) => a + b, 0);
  return roundHalfUp(sum * 10, COMPETENCIES.length);
}

/** MR-REV-02. Both band edges are inclusive on the lower side. */
export function bandFor(tenths: number | null): Band | null {
  if (tenths === null) return null;
  // MR-REV-02: both band edges are inclusive on the lower side, so exactly 4.5 is Exceeds
  // Expectations and exactly 3.0 is Meets Expectations.
  if (tenths >= 45) return 'Exceeds Expectations';
  if (tenths >= 30) return 'Meets Expectations';
  return 'Needs Improvement';
}

export interface EvaluationRow {
  id: number;
  cycle_id: number;
  subject_id: number;
  evaluator_id: number;
  type: EvaluationType;
  status: EvaluationStatus;
  comment: string | null;
  return_reason: string | null;
}

export function loadEvaluation(id: number): EvaluationRow {
  const row = getDb().prepare('SELECT * FROM evaluations WHERE id = ?').get(id) as
    | EvaluationRow
    | undefined;
  if (row === undefined) throw notFound('No such evaluation');
  return row;
}

export function ratingsOf(evaluationId: number): (number | null)[] {
  const rows = getDb()
    .prepare('SELECT competency, rating FROM competency_ratings WHERE evaluation_id = ?')
    .all(evaluationId) as { competency: Competency; rating: number | null }[];
  const byCompetency = new Map(rows.map((r) => [r.competency, r.rating]));
  return COMPETENCIES.map((c) => byCompetency.get(c) ?? null);
}

function cycleStatusOf(cycleId: number): CycleStatus {
  const row = getDb().prepare('SELECT status FROM review_cycles WHERE id = ?').get(cycleId) as
    | { status: CycleStatus }
    | undefined;
  if (row === undefined) throw notFound('No such review cycle');
  return row.status;
}

/**
 * MR-REV-06. The cycle check runs before the transition check, so an invalid transition
 * attempted inside a Closed cycle returns 422 for the closed cycle and not the 409 that
 * MR-REV-03 would return on its own. There is exactly one correct status code for that
 * request, and this ordering is what produces it.
 */
function assertCycleOpen(evaluation: EvaluationRow): void {
  if (cycleStatusOf(evaluation.cycle_id) !== 'Open') {
    // MR-REV-06: a closed-cycle refusal is 422, not the 409 the transition check would have
    // returned had it run first. There is exactly one correct status code for this request.
    throw unprocessable('The review cycle is not Open');
  }
}

// MR-REV-03's transition table, as data. "Who may fire it" and the guards are named here and
// evaluated below, so a transition that is not a row is invalid by construction.

interface TransitionRow {
  from: EvaluationStatus;
  event: EvaluationEvent;
  to: EvaluationStatus;
  who: 'evaluator' | 'subject-manager-or-admin' | 'administrator' | 'subject';
}

const TRANSITIONS: readonly TransitionRow[] = [
  { from: 'Draft', event: 'Submit', to: 'Submitted', who: 'evaluator' },
  { from: 'Draft', event: 'Cancel', to: 'Cancelled', who: 'administrator' },
  { from: 'Submitted', event: 'Return', to: 'Returned', who: 'subject-manager-or-admin' },
  { from: 'Submitted', event: 'Approve', to: 'Approved', who: 'subject-manager-or-admin' },
  { from: 'Submitted', event: 'Cancel', to: 'Cancelled', who: 'administrator' },
  { from: 'Returned', event: 'Submit', to: 'Submitted', who: 'evaluator' },
  { from: 'Returned', event: 'Cancel', to: 'Cancelled', who: 'administrator' },
  { from: 'Approved', event: 'Acknowledge', to: 'Acknowledged', who: 'subject' },
  { from: 'Approved', event: 'Cancel', to: 'Cancelled', who: 'administrator' },
];

function mayFire(row: TransitionRow, actor: Principal, evaluation: EvaluationRow): boolean {
  switch (row.who) {
    case 'evaluator':
      return actor.userId === evaluation.evaluator_id;
    case 'administrator':
      return actor.role === 'Administrator';
    case 'subject':
      return actor.userId === evaluation.subject_id;
    case 'subject-manager-or-admin':
      return actor.role === 'Administrator' || actor.userId === managerOf(evaluation.subject_id);
  }
}

/**
 * MR-REV-03. Applies an event to an evaluation.
 *
 * Check order, which the rules fix only partly: the cycle first per MR-REV-06, then whether
 * the transition exists at all, then who may fire it, then the guard. MR-REV-03 does not say
 * where permission sits relative to the transition check; see the ambiguity log.
 */
export function applyEvent(
  actor: Principal,
  evaluation: EvaluationRow,
  event: EvaluationEvent,
  payload: { returnReason?: string } = {}
): EvaluationStatus {
  // MR-REV-06: the cycle check runs before the transition check, on transitions and content
  // writes alike.
  assertCycleOpen(evaluation);

  const row = TRANSITIONS.find((t) => t.from === evaluation.status && t.event === event);
  if (row === undefined) {
    throw conflict(`${event} is not a valid transition from ${evaluation.status}`);
  }

  if (!mayFire(row, actor, evaluation)) {
    throw forbidden(`Not permitted to ${event} this evaluation`);
  }

  // Return and Approve carry the same "not the evaluator" guard. Without it on Return, an
  // evaluator could return their own submission, edit it in Returned, and resubmit it
  // without anyone else reading it, which defeats the two-person rule by a longer route.
  if (event === 'Return' || event === 'Approve') {
    if (actor.userId === evaluation.evaluator_id) {
      throw forbidden(`The evaluator may not ${event} their own submission`);
    }
  }

  if (event === 'Submit') {
    const ratings = ratingsOf(evaluation.id);
    if (ratings.some((r) => r === null)) {
      throw unprocessable('All four competencies must carry a rating before submitting');
    }
    if ((evaluation.comment ?? '').length < MINIMUM_COMMENT_LENGTH) {
      throw unprocessable(`A comment of at least ${MINIMUM_COMMENT_LENGTH} characters is required`);
    }
  }

  if (event === 'Return') {
    const reason = payload.returnReason ?? '';
    if (reason.length < MINIMUM_RETURN_REASON_LENGTH) {
      throw unprocessable(
        `A return reason of at least ${MINIMUM_RETURN_REASON_LENGTH} characters is required`
      );
    }
    getDb()
      .prepare('UPDATE evaluations SET status = ?, return_reason = ? WHERE id = ?')
      .run(row.to, reason, evaluation.id);
    return row.to;
  }

  getDb().prepare('UPDATE evaluations SET status = ? WHERE id = ?').run(row.to, evaluation.id);
  return row.to;
}

/**
 * MR-REV-03. Ratings and comments are editable only in Draft or Returned. A write in any
 * other status is rejected with 409 and changes nothing, including one that would set an
 * identical value. MR-REV-06 puts the cycle check first, so a write in a Closed cycle is 422.
 */
export function writeContent(
  actor: Principal,
  evaluation: EvaluationRow,
  content: { ratings?: Record<string, unknown>; comment?: unknown }
): void {
  assertCycleOpen(evaluation);

  if (evaluation.status !== 'Draft' && evaluation.status !== 'Returned') {
    throw conflict(`Content is editable only in Draft or Returned, not in ${evaluation.status}`);
  }
  if (actor.userId !== evaluation.evaluator_id && actor.role !== 'Administrator') {
    throw forbidden('Only the evaluator may edit this evaluation');
  }

  const ratings = content.ratings ?? {};
  for (const [competency, value] of Object.entries(ratings)) {
    if (!(COMPETENCIES as readonly string[]).includes(competency)) {
      throw unprocessable(`Unknown competency: ${competency}`);
    }
    if (!isValidRating(value)) {
      // MR-REV-01: rejected with 422, naming the offending competency, changing no stored value.
      throw unprocessable(`Rating for ${competency} must be an integer from 1 to 5`);
    }
  }
  if (content.comment !== undefined && typeof content.comment !== 'string') {
    throw unprocessable('comment must be a string');
  }

  // Nothing is written until every value has been validated, so a rejected write leaves no
  // partial state behind.
  inTransaction(() => {
    const setRating = getDb().prepare(
      'UPDATE competency_ratings SET rating = ? WHERE evaluation_id = ? AND competency = ?'
    );
    for (const [competency, value] of Object.entries(ratings)) {
      setRating.run(value as number, evaluation.id, competency);
    }
    if (content.comment !== undefined) {
      getDb()
        .prepare('UPDATE evaluations SET comment = ? WHERE id = ?')
        .run(content.comment as string, evaluation.id);
    }
  });
}

/**
 * MR-REV-04. Five conditions, checked in the stated precedence order so the error a caller
 * sees is deterministic: cycle state first, then permission, then duplication.
 */
export function createEvaluation(actor: Principal, cycleId: number, subjectId: number): number {
  // C1.
  if (cycleStatusOf(cycleId) !== 'Open') throw unprocessable('The review cycle is not Open');

  const subject = getDb().prepare('SELECT id FROM users WHERE id = ?').get(subjectId);
  if (subject === undefined) throw unprocessable('No such subject');

  // C3.
  const isSelf = subjectId === actor.userId;
  const type: EvaluationType = isSelf ? 'Self' : 'Manager';

  if (!isSelf) {
    // C2 and C4. Rules 4 and 7: an Associate may not evaluate anyone else, and a Manager may
    // evaluate a direct report only. A skip-level report, a peer, and their own manager are
    // all rejected, and the rejection comes from here rather than from an absent button.
    if (actor.role === 'Associate') throw forbidden('An Associate may only evaluate themselves');
    if (actor.role === 'Manager' && !isDirectReport(actor.userId, subjectId)) {
      throw forbidden('A Manager may evaluate a direct report only');
    }
  }

  // C5. Cancelled is excluded: a cancelled evaluation does not occupy the combination.
  const duplicate = getDb()
    .prepare(
      `SELECT id FROM evaluations
        WHERE cycle_id = ? AND subject_id = ? AND evaluator_id = ? AND type = ?
          AND status <> 'Cancelled'`
    )
    .get(cycleId, subjectId, actor.userId, type);
  if (duplicate !== undefined) throw conflict('An evaluation already exists for this combination');

  return inTransaction(() => {
    const result = getDb()
      .prepare(
        `INSERT INTO evaluations (cycle_id, subject_id, evaluator_id, type, status)
         VALUES (?, ?, ?, ?, 'Draft')`
      )
      .run(cycleId, subjectId, actor.userId, type);
    const evaluationId = Number(result.lastInsertRowid);

    // All four rows exist from creation, so "unrated" is a null rating and not a missing row.
    const insertRating = getDb().prepare(
      'INSERT INTO competency_ratings (evaluation_id, competency, rating) VALUES (?, ?, NULL)'
    );
    for (const competency of COMPETENCIES) insertRating.run(evaluationId, competency);

    return evaluationId;
  });
}

/**
 * MR-REV-05. Read access depends on who is asking and what status the evaluation is in. A
 * read that is not permitted returns 403 and a body carrying no ratings, no comments, and no
 * overall score, so the data does not leave the server at all.
 */
export function canReadEvaluation(actor: Principal, evaluation: EvaluationRow): boolean {
  if (actor.role === 'Administrator') return true;
  if (actor.userId === evaluation.evaluator_id) return true;

  if (actor.userId === evaluation.subject_id && evaluation.type === 'Manager') {
    return evaluation.status === 'Approved' || evaluation.status === 'Acknowledged';
  }

  if (actor.userId === managerOf(evaluation.subject_id)) {
    return !['Draft', 'Returned', 'Cancelled'].includes(evaluation.status);
  }

  return false;
}

export function assertCanReadEvaluation(actor: Principal, evaluation: EvaluationRow): void {
  if (!canReadEvaluation(actor, evaluation)) throw forbidden('Not permitted to read this evaluation');
}

/** MR-REV-06. Only an Administrator changes cycle status. Planned to Open, Open to Closed. */
export function setCycleStatus(actor: Principal, cycleId: number, to: CycleStatus): void {
  if (actor.role !== 'Administrator') throw forbidden('Only an Administrator changes cycle status');

  const from = cycleStatusOf(cycleId);
  const allowed = (from === 'Planned' && to === 'Open') || (from === 'Open' && to === 'Closed');
  if (!allowed) throw conflict(`A cycle cannot move from ${from} to ${to}`);

  getDb().prepare('UPDATE review_cycles SET status = ? WHERE id = ?').run(to, cycleId);
}
