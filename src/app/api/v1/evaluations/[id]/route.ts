import { requireSession } from '../../../../../lib/authz';
import { respond, unprocessable } from '../../../../../lib/errors';
import {
  assertCanReadEvaluation,
  bandFor,
  loadEvaluation,
  overallTenths,
  ratingsOf,
} from '../../../../../lib/evaluation';

/** MR-REV-05. A refused read carries no ratings, no comment, and no overall score. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const evaluationId = Number(id);
    if (!Number.isInteger(evaluationId)) throw unprocessable('Evaluation id must be an integer');

    const evaluation = loadEvaluation(evaluationId);
    assertCanReadEvaluation(principal, evaluation);

    const ratings = ratingsOf(evaluation.id);
    const tenths = overallTenths(ratings);

    return Response.json({
      id: evaluation.id,
      cycleId: evaluation.cycle_id,
      subjectId: evaluation.subject_id,
      evaluatorId: evaluation.evaluator_id,
      type: evaluation.type,
      status: evaluation.status,
      comment: evaluation.comment,
      returnReason: evaluation.return_reason,
      ratings,
      overallTenths: tenths,
      overall: tenths === null ? null : tenths / 10,
      band: bandFor(tenths),
    });
  });
}
