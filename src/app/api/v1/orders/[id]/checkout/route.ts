import { requireSession } from '../../../../../../lib/authz';
import { respond } from '../../../../../../lib/errors';
import { assertCanReadOrder, loadOrder, submitCheckout } from '../../../../../../lib/order';

/** MR-STO-06 Cart to Pending Payment. MR-STO-07: availability is checked, not reserved. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const order = loadOrder(Number(id));
    assertCanReadOrder(principal, order);

    submitCheckout(order);
    return Response.json({ status: loadOrder(order.id).status });
  });
}
