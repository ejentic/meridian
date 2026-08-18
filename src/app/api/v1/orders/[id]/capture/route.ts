import { requireSession } from '../../../../../../lib/authz';
import { now } from '../../../../../../lib/clock';
import { respond, unprocessable } from '../../../../../../lib/errors';
import {
  type CaptureOutcome,
  assertCanReadOrder,
  capture,
  loadOrder,
} from '../../../../../../lib/order';

/**
 * MR-STO-06 Pending Payment to Paid or Payment Failed, and MR-STO-07's transaction.
 *
 * `outcome` stands in for the payment gateway result. The specification does not say what
 * decides it, and a facilitator has to be able to demonstrate a declined capture; see the
 * ambiguity log.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const order = loadOrder(Number(id));
    assertCanReadOrder(principal, order);

    const body = (await request.json().catch(() => ({}))) as { outcome?: unknown };
    const outcome = body.outcome ?? 'success';
    if (outcome !== 'success' && outcome !== 'decline') {
      throw unprocessable("outcome must be 'success' or 'decline'");
    }

    const result = capture(order, outcome as CaptureOutcome, now());
    return Response.json(result);
  });
}
