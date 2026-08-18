import { getDb } from '../../../../../db/index';
import { requireRole, requireSession } from '../../../../../lib/authz';
import { notFound, respond, unprocessable } from '../../../../../lib/errors';
import { assertNonNegativeInteger } from '../validate';

const EDITABLE = ['name', 'unitPriceCents', 'onHandQty'] as const;

const COLUMN: Record<(typeof EDITABLE)[number], string> = {
  name: 'name',
  unitPriceCents: 'unit_price_cents',
  onHandQty: 'on_hand_qty',
};

/**
 * MR-PLT-01: product and stock maintenance is Administrator only. This is how stock is
 * maintained, so it is also where MR-STO-07's floor is enforced on a write a person makes
 * rather than one a capture makes.
 *
 * Changing a price here does not change an order already in progress. MR-STO-02 says a line
 * carries the unit price in effect when it was added, and the line stores its own copy, so
 * that follows from the data rather than from a rule this handler has to remember.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    requireRole(principal, 'Administrator');

    const { id } = await context.params;
    const productId = Number(id);
    if (!Number.isInteger(productId)) throw unprocessable('Product id must be an integer');

    const existing = getDb().prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (existing === undefined) throw notFound('No such product');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const unknownFields = Object.keys(body).filter(
      (key) => !(EDITABLE as readonly string[]).includes(key)
    );
    if (unknownFields.length > 0) {
      // The sku is not editable. It is the identifier a worksheet names when it tells a
      // trainee which product to add, so letting it change would make those instructions
      // stop matching the screen.
      throw unprocessable(`Only ${EDITABLE.join(', ')} may be changed, not: ${unknownFields.join(', ')}`);
    }

    if ('name' in body && (typeof body.name !== 'string' || body.name.length === 0)) {
      throw unprocessable('name must be a non-empty string');
    }
    if ('unitPriceCents' in body) assertNonNegativeInteger('unitPriceCents', body.unitPriceCents);
    if ('onHandQty' in body) assertNonNegativeInteger('onHandQty', body.onHandQty);

    // Nothing is written until every value has been validated, so a rejected patch leaves no
    // partial state behind.
    for (const field of EDITABLE) {
      if (field in body) {
        getDb()
          .prepare(`UPDATE products SET ${COLUMN[field]} = ? WHERE id = ?`)
          .run(body[field] as string | number, productId);
      }
    }

    const updated = getDb()
      .prepare(
        `SELECT id, sku, name, unit_price_cents AS unitPriceCents, on_hand_qty AS onHandQty
           FROM products WHERE id = ?`
      )
      .get(productId);
    return Response.json(updated);
  });
}
