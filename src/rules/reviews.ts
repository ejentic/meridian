'use client';

import type {
  EvaluationEvent,
  EvaluationStatus,
  Principal,
} from '../shared/types';

/**
 * Reviews role logic, as the interface sees it.
 *
 * THIS DUPLICATES the TRANSITIONS table in src/lib/evaluation.ts ON PURPOSE, per MR-PLT-02:
 * the interface decides what to render and the server decides what to allow, and the whole
 * point is that those two decisions are independent and can therefore disagree. Do not
 * replace this with a permitted-events field returned by the API. See src/rules/storefront.ts
 * for the full reasoning; it applies here identically.
 */

interface TransitionRow {
  from: EvaluationStatus;
  event: EvaluationEvent;
  who: 'evaluator' | 'subject-manager-or-admin' | 'administrator' | 'subject';
}

/**
 * MR-REV-03's table, as data rather than as a chain of conditionals.
 *
 * Written as a table for the same reason the server's copy is: "every transition not listed
 * is invalid" is then enforced by the absence of a row instead of by remembering to write an
 * else. This is the most defect-prone visibility logic in the application, because the
 * "who may fire it" column is five distinct rules and each gives a different answer for a
 * different caller looking at the same evaluation.
 */
const TRANSITIONS: readonly TransitionRow[] = [
  { from: 'Draft', event: 'Submit', who: 'evaluator' },
  { from: 'Draft', event: 'Cancel', who: 'administrator' },
  { from: 'Submitted', event: 'Return', who: 'subject-manager-or-admin' },
  { from: 'Submitted', event: 'Approve', who: 'subject-manager-or-admin' },
  { from: 'Submitted', event: 'Cancel', who: 'administrator' },
  { from: 'Returned', event: 'Submit', who: 'evaluator' },
  { from: 'Returned', event: 'Cancel', who: 'administrator' },
  { from: 'Approved', event: 'Acknowledge', who: 'subject' },
  { from: 'Approved', event: 'Cancel', who: 'administrator' },
];

export interface EvaluationFacts {
  status: EvaluationStatus;
  evaluatorId: number;
  subjectId: number;
  /**
   * The subject's manager, or null when they have none.
   *
   * Derived on the client from GET /me/reports: if the subject is one of the caller's own
   * reports then the caller is the subject's manager. That read returns people and not
   * permissions, and the rule below is applied to it here. A caller who is not the subject's
   * manager passes null, which fails closed, exactly as MR-PLT-01 says a null `managerId`
   * should.
   */
  subjectManagerId: number | null;
}

function mayFire(row: TransitionRow, principal: Principal, evaluation: EvaluationFacts): boolean {
  switch (row.who) {
    case 'evaluator':
      return principal.userId === evaluation.evaluatorId;
    case 'administrator':
      return principal.role === 'Administrator';
    case 'subject':
      return principal.userId === evaluation.subjectId;
    case 'subject-manager-or-admin':
      return (
        principal.role === 'Administrator' || principal.userId === evaluation.subjectManagerId
      );
  }
}

/**
 * The events this caller may fire on this evaluation from its current status.
 *
 * Mirrors the server's applyEvent: the transition has to exist, then who may fire it, then
 * the extra guard Return and Approve share.
 *
 * The content guards are deliberately not applied. MR-REV-03 makes "all four rated and a
 * comment of at least 20 characters" a guard on Submit and not a permission, so the control
 * is drawn and the server refuses with 422. Hiding Submit until a Draft is complete would
 * leave a trainee with a screen offering nothing and no explanation, and would quietly
 * relocate a rule the server owns.
 */
export function permittedEvents(
  evaluation: EvaluationFacts,
  principal: Principal
): EvaluationEvent[] {
  return TRANSITIONS.filter((row) => row.from === evaluation.status)
    .filter((row) => mayFire(row, principal, evaluation))
    .filter((row) => {
      // Return and Approve carry the same "not the evaluator" guard. Without it on Return,
      // an evaluator could return their own submission, edit it in Returned, and resubmit
      // it without anyone else reading it, which defeats the two-person rule by a longer
      // route than approving it outright.
      if (row.event === 'Return' || row.event === 'Approve') {
        return principal.userId !== evaluation.evaluatorId;
      }
      return true;
    })
    .map((row) => row.event);
}

/** MR-REV-03. Ratings and comments are editable only in Draft or Returned. */
export function isContentEditable(
  evaluation: { status: EvaluationStatus; evaluatorId: number },
  principal: Principal
): boolean {
  if (evaluation.status !== 'Draft' && evaluation.status !== 'Returned') return false;
  return principal.userId === evaluation.evaluatorId || principal.role === 'Administrator';
}

/**
 * MR-REV-04's decision table, reduced to the question a subject picker asks: may this caller
 * create an evaluation of this person?
 *
 * Rules 2 and 3 give everyone themselves. Rule 4 refuses an Associate anyone else. Rules 5
 * and 7 give a Manager their direct reports and nobody else. Rule 8 gives an Administrator
 * anyone. C1 and C5, the cycle state and the duplicate check, are not here: both are
 * properties of a cycle and a combination rather than of a person, and the server refuses
 * them with 422 and 409 respectively.
 */
export function mayEvaluate(
  principal: Principal,
  subjectId: number,
  directReportIds: readonly number[]
): boolean {
  if (subjectId === principal.userId) return true;
  if (principal.role === 'Administrator') return true;
  if (principal.role === 'Associate') return false;
  return directReportIds.includes(subjectId);
}
