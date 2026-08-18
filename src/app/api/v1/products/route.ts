import { getDb } from '../../../../db/index';
import { requireRole, requireSession } from '../../../../lib/authz';
import { conflict, respond, unprocessable } from '../../../../lib/errors';
import { assertNonNegativeInteger } from './validate';

/**
 * MR-PLT-01: every role browses products, so this is gated on a live session and nothing
 * more. Prices are integer cents per MR-STO-01 and are sent as cents; the interface formats
 * them and never does arithmetic on them.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    requireSession(request);

    const products = getDb()
      .prepare(
        `SELECT id, sku, name, unit_price_cents AS unitPriceCents, on_hand_qty AS onHandQty
           FROM products
          ORDER BY id`
      )
      .all();
    return Response.json({ products });
  });
}

/** MR-PLT-01: product and stock maintenance is Administrator only. */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    requireRole(principal, 'Administrator');

    const body = (await request.json().catch(() => ({}))) as {
      sku?: unknown;
      name?: unknown;
      unitPriceCents?: unknown;
      onHandQty?: unknown;
    };

    if (typeof body.sku !== 'string' || body.sku.length === 0) throw unprocessable('sku is required');
    if (typeof body.name !== 'string' || body.name.length === 0) {
      throw unprocessable('name is required');
    }
    assertNonNegativeInteger('unitPriceCents', body.unitPriceCents);
    // MR-STO-07: on-hand quantity is an integer and may never go below 0. Zero is a real
    // quantity and not an error, so the floor is 0 rather than 1.
    assertNonNegativeInteger('onHandQty', body.onHandQty);

    const duplicate = getDb().prepare('SELECT id FROM products WHERE sku = ?').get(body.sku);
    if (duplicate !== undefined) throw conflict('A product with that sku already exists');

    const result = getDb()
      .prepare('INSERT INTO products (sku, name, unit_price_cents, on_hand_qty) VALUES (?, ?, ?, ?)')
      .run(body.sku, body.name, body.unitPriceCents as number, body.onHandQty as number);

    return Response.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  });
}
