import { requireSession } from '../../../../../../lib/authz';
import { respond } from '../../../../../../lib/errors';
import { loadEvaluation, ratingsOf, writeContent } from '../../../../../../lib/evaluation';

/** MR-REV-01 validation and MR-REV-03's edit lock. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const evaluation = loadEvaluation(Number(id));

    const body = (await request.json().catch(() => ({}))) as {
      ratings?: Record<string, unknown>;
      comment?: unknown;
    };

    writeContent(principal, evaluation, body);
    return Response.json({ ratings: ratingsOf(evaluation.id) });
  });
}
