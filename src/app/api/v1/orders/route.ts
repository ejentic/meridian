import { getDb } from '../../../../db/index';
import { requireSession } from '../../../../lib/authz';
import { respond } from '../../../../lib/errors';
import { canReadOrder, createCart, totalsFor, type OrderRow } from '../../../../lib/order';

/** MR-PLT-01: every role may manage their own cart. */
export async function POST(request: Request): Promise<Response> {
  return respond(() => {
    const principal = requireSession(request);
    const orderId = createCart(principal.userId);
    return Response.json({ orderId, status: 'Cart' }, { status: 201 });
  });
}

/**
 * MR-PLT-01 read scope: an Associate sees their own orders, a Manager theirs and their
 * direct reports', an Administrator all of them.
 *
 * The scope is `canReadOrder`, the same predicate GET /orders/[id] uses, applied row by row.
 * Expressing it a second time in SQL would be faster and is refused deliberately: a list and
 * a detail that disagree about who may see an order is precisely the defect class C.2 plants
 * on purpose, and it must not arrive here by accident. With one predicate there is nothing
 * to drift.
 *
 * The row carries no lines. A list is a read like any other, and a caller who wants an
 * order's contents asks for that order.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    const principal = requireSession(request);

    const all = getDb().prepare('SELECT * FROM orders ORDER BY id').all() as OrderRow[];

    const orders = all
      .filter((order) => canReadOrder(principal, order))
      .map((order) => ({
        id: order.id,
        userId: order.user_id,
        status: order.status,
        // The captured total once there is one, and the composed total before then, so a
        // list row shows what the order is worth at the status it is actually in.
        totalCents: order.captured_total_cents ?? totalsFor(order).totalCents,
        capturedAtMs: order.captured_at_ms,
      }));

    return Response.json({ orders });
  });
}
