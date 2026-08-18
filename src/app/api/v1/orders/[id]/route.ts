import { requireSession } from '../../../../../lib/authz';
import { respond, unprocessable } from '../../../../../lib/errors';
import { assertCanReadOrder, loadLines, loadOrder, totalsFor } from '../../../../../lib/order';

/**
 * MR-PLT-01 read scope, enforced on the server. An Associate reads their own orders, a
 * Manager theirs and their direct reports', an Administrator all of them. A read that is not
 * permitted returns 403 and carries no order data at all.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const orderId = Number(id);
    if (!Number.isInteger(orderId)) throw unprocessable('Order id must be an integer');

    const order = loadOrder(orderId);
    assertCanReadOrder(principal, order);

    return Response.json({
      id: order.id,
      userId: order.user_id,
      status: order.status,
      lines: loadLines(order.id),
      totals: totalsFor(order),
      capturedTotalCents: order.captured_total_cents,
      capturedShippingCents: order.captured_shipping_cents,
      capturedAtMs: order.captured_at_ms,
    });
  });
}
