import { requireSession } from '../../../../../../lib/authz';
import { respond } from '../../../../../../lib/errors';
import { assertCanReadOrder, cancel, loadOrder } from '../../../../../../lib/order';

/** MR-STO-06. Cancelled is terminal and has no outgoing transitions. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;
    const order = loadOrder(Number(id));
    assertCanReadOrder(principal, order);

    cancel(order);
    return Response.json({ status: 'Cancelled' });
  });
}
