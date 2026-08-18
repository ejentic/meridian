import { requireSession } from '../../../../../../lib/authz';
import { now } from '../../../../../../lib/clock';
import { respond, unprocessable } from '../../../../../../lib/errors';
import {
  applyDiscountCode,
  assertCanReadOrder,
  loadOrder,
  totalsFor,
} from '../../../../../../lib/order';

/** MR-STO-03. A second code replaces the first rather than stacking. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const order = loadOrder(Number(id));
    assertCanReadOrder(principal, order);

    const body = (await request.json().catch(() => ({}))) as { code?: unknown };
    if (typeof body.code !== 'string') throw unprocessable('code is required');

    applyDiscountCode(order, body.code, now());
    return Response.json({ totals: totalsFor(loadOrder(order.id)) });
  });
}
