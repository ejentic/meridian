import { requireSession } from '../../../../../../lib/authz';
import { respond, unprocessable } from '../../../../../../lib/errors';
import { addLine, assertCanReadOrder, loadOrder, totalsFor } from '../../../../../../lib/order';

/**
 * MR-STO-06's write lock lives in addLine(): a line write outside Cart is a 409 that changes
 * nothing, including one that would set an identical value.
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

    const body = (await request.json().catch(() => ({}))) as {
      productId?: unknown;
      quantity?: unknown;
    };
    if (typeof body.productId !== 'number' || typeof body.quantity !== 'number') {
      throw unprocessable('productId and quantity are required');
    }

    addLine(order, body.productId, body.quantity);
    return Response.json({ totals: totalsFor(loadOrder(order.id)) });
  });
}
