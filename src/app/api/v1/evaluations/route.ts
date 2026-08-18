import { getDb } from '../../../../db/index';
import { requireSession } from '../../../../lib/authz';
import { respond, unprocessable } from '../../../../lib/errors';
import {
  canReadEvaluation,
  createEvaluation,
  type EvaluationRow,
} from '../../../../lib/evaluation';

/**
 * MR-REV-05, applied row by row with `canReadEvaluation`, the same predicate
 * GET /evaluations/[id] uses.
 *
 * The rows are loaded and filtered in TypeScript rather than filtered in SQL. A WHERE clause
 * would be faster and would be a second expression of a rule whose whole difficulty is that
 * it depends on status as well as on who is asking: the subject sees a Manager-type
 * evaluation only once it is Approved or Acknowledged, and the subject's manager never sees
 * Draft, Returned, or Cancelled. Two copies of that can drift, and a list that drifts leaks
 * precisely what MR-REV-05 exists to prevent. Correctness first; this is a fixture with a
 * handful of rows.
 *
 * The response carries no ratings, no comment, and no overall score. Those are the fields
 * MR-REV-05 governs, and a list is a read like any other.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    const principal = requireSession(request);

    const all = getDb()
      .prepare('SELECT * FROM evaluations ORDER BY id')
      .all() as EvaluationRow[];

    const evaluations = all
      .filter((evaluation) => canReadEvaluation(principal, evaluation))
      .map((evaluation) => ({
        id: evaluation.id,
        cycleId: evaluation.cycle_id,
        subjectId: evaluation.subject_id,
        evaluatorId: evaluation.evaluator_id,
        type: evaluation.type,
        status: evaluation.status,
      }));

    return Response.json({ evaluations });
  });
}

/** MR-REV-04. The type is decided by the rule, never supplied by the caller. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const body = (await request.json().catch(() => ({}))) as {
      cycleId?: unknown;
      subjectId?: unknown;
    };
    if (typeof body.cycleId !== 'number' || typeof body.subjectId !== 'number') {
      throw unprocessable('cycleId and subjectId are required');
    }

    const id = createEvaluation(principal, body.cycleId, body.subjectId);
    return Response.json({ id }, { status: 201 });
  });
}
