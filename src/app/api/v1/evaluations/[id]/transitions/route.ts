import { requireSession } from '../../../../../../lib/authz';
import { respond, unprocessable } from '../../../../../../lib/errors';
import {
  type EvaluationEvent,
  applyEvent,
  loadEvaluation,
} from '../../../../../../lib/evaluation';

const EVENTS: readonly EvaluationEvent[] = ['Submit', 'Cancel', 'Return', 'Approve', 'Acknowledge'];

/**
 * MR-REV-03. One endpoint per transition table rather than per transition, because the rule
 * is a table and an endpoint that mirrors it cannot drift from it.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const evaluation = loadEvaluation(Number(id));

    const body = (await request.json().catch(() => ({}))) as {
      event?: unknown;
      returnReason?: unknown;
    };
    if (!EVENTS.includes(body.event as EvaluationEvent)) {
      throw unprocessable(`event must be one of: ${EVENTS.join(', ')}`);
    }

    const status = applyEvent(principal, evaluation, body.event as EvaluationEvent, {
      returnReason: typeof body.returnReason === 'string' ? body.returnReason : undefined,
    });
    return Response.json({ status });
  });
}
