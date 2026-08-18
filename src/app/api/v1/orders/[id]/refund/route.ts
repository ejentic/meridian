import { requireSession } from '../../../../../../lib/authz';
import { now } from '../../../../../../lib/clock';
import { respond, unprocessable } from '../../../../../../lib/errors';
import { loadOrder, refund } from '../../../../../../lib/order';

/**
 * MR-STO-08. Requesting and executing a refund are one action.
 *
 * The read-scope check is deliberately absent here: MR-STO-08 states its own authority rule
 * and requires permission to be checked before any transition check, and a Manager's refund
 * scope is already a strict subset of their read scope. Adding a read check first would
 * change which of 403 and 409 a caller sees, and the rule fixes that ordering.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const order = loadOrder(Number(id));

    const body = (await request.json().catch(() => ({}))) as { lineIds?: unknown };
    if (!Array.isArray(body.lineIds) || body.lineIds.some((v) => typeof v !== 'number')) {
      throw unprocessable('lineIds must be an array of line ids');
    }

    return Response.json(refund(principal, order, body.lineIds as number[], now()));
  });
}
