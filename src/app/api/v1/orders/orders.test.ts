import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE, SEED_PASSWORD, req, resetAndSeed, tokenFromResponse } from '../../../../test-support/fixture';
import { closeDb, getDb } from '../../../../db/index';
import { resetClock, setClock } from '../../../../lib/clock';
import { POST as signIn } from '../auth/signin/route';
import { GET as listOrders, POST as createOrder } from './route';
import { GET as listProducts, POST as createProduct } from '../products/route';
import { PATCH as updateProduct } from '../products/[id]/route';
import { GET as readOrder } from './[id]/route';
import { POST as addLine } from './[id]/lines/route';
import { POST as applyDiscount } from './[id]/discount/route';
import { POST as checkout } from './[id]/checkout/route';
import { POST as capture } from './[id]/capture/route';
import { POST as refund } from './[id]/refund/route';
import { POST as cancel } from './[id]/cancel/route';

const AT = Date.UTC(2026, 7, 11, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

// Seeded products: 1, 2, 3 are $49.90; 4 is $14.55; 5 is $210.00; 9 is $99.00 with one unit
// on hand, which is the last-unit contention case MR-STO-07 names.
const P1 = 1;
const P2 = 2;
const P3 = 3;
const LAST_UNIT = 9;

// The two roles MR-PLT-01 does not grant product and stock maintenance to.
const NON_ADMIN_ROLES = [
  { role: 'Manager', email: 'manager01@meridian-corp.test' },
  { role: 'Associate', email: 'associate01@meridian-corp.test' },
] as const;

beforeEach(() => {
  resetAndSeed();
  setClock(AT);
});

afterEach(() => {
  resetClock();
});

afterAll(() => {
  closeDb();
});

async function signInAs(email: string): Promise<string> {
  const response = await signIn(
    req('POST', '/api/v1/auth/signin', { body: { email, password: SEED_PASSWORD } })
  );
  return tokenFromResponse(response);
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function newCart(token: string): Promise<number> {
  const response = await createOrder(req('POST', '/api/v1/orders', { token }));
  expect(response.status).toBe(201);
  return (await response.json()).orderId as number;
}

async function addProduct(
  token: string,
  orderId: number,
  productId: number,
  quantity = 1
): Promise<Response> {
  return addLine(
    req('POST', `/api/v1/orders/${orderId}/lines`, { token, body: { productId, quantity } }),
    params(orderId)
  );
}

function onHand(productId: number): number {
  return (
    getDb().prepare('SELECT on_hand_qty AS q FROM products WHERE id = ?').get(productId) as {
      q: number;
    }
  ).q;
}

function statusOf(orderId: number): string {
  return (
    getDb().prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string }
  ).status;
}

describe('the money path, end to end', () => {
  it('takes an Associate from an empty cart to a paid order at the published total', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);

    for (const product of [P1, P2, P3]) await addProduct(token, orderId, product);
    await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SAVE10' } }),
      params(orderId)
    );

    const before = await readOrder(req('GET', `/api/v1/orders/${orderId}`, { token }), params(orderId));
    expect((await before.json()).totals).toMatchObject({
      orderSubtotalCents: 14970,
      discountCents: 1497,
      discountedSubtotalCents: 13473,
      taxCents: 1112,
      shippingCents: 1200,
      totalCents: 15785,
    });

    expect(
      (await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId)))
        .status
    ).toBe(200);
    expect(statusOf(orderId)).toBe('Pending Payment');

    const captured = await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'success' } }),
      params(orderId)
    );
    expect(await captured.json()).toMatchObject({ status: 'Paid', capturedTotalCents: 15785 });
    expect(statusOf(orderId)).toBe('Paid');
  });
});

describe('MR-STO-07 the decrement and the Paid write are one transaction', () => {
  it('decrements on-hand quantity only when capture succeeds', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1, 3);
    expect(onHand(P1)).toBe(100);

    await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId));
    // Adding to a cart does not reserve stock, and neither does checkout.
    expect(onHand(P1)).toBe(100);

    await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'success' } }),
      params(orderId)
    );
    expect(onHand(P1)).toBe(97);
  });

  it('leaves stock unchanged when the capture declines', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1, 3);
    await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId));

    const response = await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'decline' } }),
      params(orderId)
    );

    expect(await response.json()).toMatchObject({ status: 'Payment Failed', reason: 'declined' });
    expect(onHand(P1)).toBe(100);
    expect(
      getDb().prepare('SELECT captured_total_cents AS c FROM orders WHERE id = ?').get(orderId)
    ).toEqual({ c: null });
  });

  it('rolls the capture back when a line went out of stock first, and charges nothing', async () => {
    // Two orders compete for the last unit. Exactly one reaches Paid.
    const first = await signInAs('associate01@meridian-corp.test');
    const firstOrder = await newCart(first);
    await addProduct(first, firstOrder, LAST_UNIT, 1);
    await checkout(req('POST', `/api/v1/orders/${firstOrder}/checkout`, { token: first }), params(firstOrder));

    const second = await signInAs('associate02@meridian-corp.test');
    const secondOrder = await newCart(second);
    await addProduct(second, secondOrder, LAST_UNIT, 1);
    // Both pass the checkout availability guard, because checkout reserves nothing.
    await checkout(req('POST', `/api/v1/orders/${secondOrder}/checkout`, { token: second }), params(secondOrder));

    await capture(
      req('POST', `/api/v1/orders/${firstOrder}/capture`, { token: first, body: { outcome: 'success' } }),
      params(firstOrder)
    );
    expect(statusOf(firstOrder)).toBe('Paid');
    expect(onHand(LAST_UNIT)).toBe(0);

    const loser = await capture(
      req('POST', `/api/v1/orders/${secondOrder}/capture`, {
        token: second,
        body: { outcome: 'success' },
      }),
      params(secondOrder)
    );

    expect(await loser.json()).toMatchObject({ status: 'Payment Failed', reason: 'out_of_stock' });
    // On-hand never went below zero, and the loser was not charged.
    expect(onHand(LAST_UNIT)).toBe(0);
    expect(
      getDb().prepare('SELECT captured_total_cents AS c FROM orders WHERE id = ?').get(secondOrder)
    ).toEqual({ c: null });
  });
});

describe('MR-STO-06 transitions and the write lock', () => {
  async function paidOrder(token: string): Promise<number> {
    const orderId = await newCart(token);
    for (const product of [P1, P2, P3]) await addProduct(token, orderId, product);
    await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SAVE10' } }),
      params(orderId)
    );
    await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId));
    await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'success' } }),
      params(orderId)
    );
    return orderId;
  }

  it('rejects Cart to Paid with 409', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1);

    const response = await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'success' } }),
      params(orderId)
    );
    expect(response.status).toBe(409);
    expect(statusOf(orderId)).toBe('Cart');
    expect(onHand(P1)).toBe(100);
  });

  it('rejects any transition out of Cancelled with 409', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1);
    await cancel(req('POST', `/api/v1/orders/${orderId}/cancel`, { token }), params(orderId));
    expect(statusOf(orderId)).toBe('Cancelled');

    const response = await checkout(
      req('POST', `/api/v1/orders/${orderId}/checkout`, { token }),
      params(orderId)
    );
    expect(response.status).toBe(409);
    expect(statusOf(orderId)).toBe('Cancelled');
  });

  it('rejects a line write outside Cart with 409 and changes nothing', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await paidOrder(token);

    const response = await addProduct(token, orderId, P1, 5);
    expect(response.status).toBe(409);

    const lines = getDb()
      .prepare('SELECT product_id, quantity FROM order_lines WHERE order_id = ? ORDER BY id')
      .all(orderId);
    expect(lines).toEqual([
      { product_id: P1, quantity: 1 },
      { product_id: P2, quantity: 1 },
      { product_id: P3, quantity: 1 },
    ]);
  });

  it('rejects a write that would set an identical value, not only a changing one', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await paidOrder(token);

    // The order already carries SAVE10. Reapplying the same code is still a content edit.
    const response = await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SAVE10' } }),
      params(orderId)
    );
    expect(response.status).toBe(409);
  });

  it('lets a failed payment be retried and then paid', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1);
    await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId));
    await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'decline' } }),
      params(orderId)
    );
    expect(statusOf(orderId)).toBe('Payment Failed');

    await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId));
    expect(statusOf(orderId)).toBe('Pending Payment');
    await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'success' } }),
      params(orderId)
    );
    expect(statusOf(orderId)).toBe('Paid');
  });
});

describe('MR-STO-03 one code per order', () => {
  it('replaces the first code rather than stacking', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1);
    await addProduct(token, orderId, P2);
    await addProduct(token, orderId, P3);

    await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SAVE10' } }),
      params(orderId)
    );
    const second = await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SAVE50' } }),
      params(orderId)
    );

    // 149.70 at 50% is a discount of 74.85, not 10% and 50% compounded.
    expect((await second.json()).totals).toMatchObject({
      discountCents: 7485,
      discountedSubtotalCents: 7485,
    });
  });

  it('refuses an expired code and an inactive one', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1);

    const lapsed = await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'LAPSED' } }),
      params(orderId)
    );
    expect(lapsed.status).toBe(422);

    const off = await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SWITCHEDOFF' } }),
      params(orderId)
    );
    expect(off.status).toBe(422);
  });
});

describe('MR-STO-08 refunds', () => {
  async function paidThreeLineOrder(token: string): Promise<{ orderId: number; lineIds: number[] }> {
    const orderId = await newCart(token);
    for (const product of [P1, P2, P3]) await addProduct(token, orderId, product);
    await applyDiscount(
      req('POST', `/api/v1/orders/${orderId}/discount`, { token, body: { code: 'SAVE10' } }),
      params(orderId)
    );
    await checkout(req('POST', `/api/v1/orders/${orderId}/checkout`, { token }), params(orderId));
    await capture(
      req('POST', `/api/v1/orders/${orderId}/capture`, { token, body: { outcome: 'success' } }),
      params(orderId)
    );
    const lineIds = (
      getDb().prepare('SELECT id FROM order_lines WHERE order_id = ? ORDER BY id').all(orderId) as {
        id: number;
      }[]
    ).map((r) => r.id);
    return { orderId, lineIds };
  }

  it('refunds the published sequence and sums to exactly the captured total', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(associate);
    const manager = await signInAs('manager01@meridian-corp.test');

    const amounts: number[] = [];
    for (const [index, lineId] of lineIds.entries()) {
      const response = await refund(
        req('POST', `/api/v1/orders/${orderId}/refund`, {
          token: manager,
          body: { lineIds: [lineId] },
        }),
        params(orderId)
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      amounts.push(body.refundCents);
      expect(body.status).toBe(index === lineIds.length - 1 ? 'Refunded' : 'Partially Refunded');
    }

    expect(amounts).toEqual([4862, 4861, 6062]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(15785);
    expect(amounts.reduce((a, b) => a + b, 0)).not.toBe(15786);
  });

  it('restocks the refunded lines immediately', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(associate);
    expect(onHand(P1)).toBe(99);

    const manager = await signInAs('manager01@meridian-corp.test');
    await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, { token: manager, body: { lineIds: [lineIds[0]] } }),
      params(orderId)
    );
    expect(onHand(P1)).toBe(100);
  });

  it('accepts day 10 and rejects day 11', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(associate);

    // Sign in after moving the clock, not before. MR-PLT-03 caps a session at 12 hours, so
    // no session issued on capture day survives to the edge of MR-STO-08's 10 day window.
    // The two rules do not conflict, but any refund past the first day needs a fresh
    // sign-in, and a test that reuses the old token measures session expiry instead of the
    // refund window.
    setClock(AT + 11 * DAY);
    const late = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, {
        token: await signInAs('manager01@meridian-corp.test'),
        body: { lineIds: [lineIds[0]] },
      }),
      params(orderId)
    );
    expect(late.status).toBe(422);
    expect(statusOf(orderId)).toBe('Paid');
    expect(onHand(P1)).toBe(99);

    setClock(AT + 10 * DAY);
    const onTime = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, {
        token: await signInAs('manager01@meridian-corp.test'),
        body: { lineIds: [lineIds[0]] },
      }),
      params(orderId)
    );
    expect(onTime.status).toBe(200);
  });

  it('refuses an Associate a refund on their own order with 403', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(associate);

    const response = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, {
        token: associate,
        body: { lineIds: [lineIds[0]] },
      }),
      params(orderId)
    );

    expect(response.status).toBe(403);
    expect(statusOf(orderId)).toBe('Paid');
    expect(onHand(P1)).toBe(99);
  });

  it('refuses a Manager a refund on an order they placed themselves with 403', async () => {
    const manager = await signInAs('manager01@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(manager);

    const response = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, {
        token: manager,
        body: { lineIds: [lineIds[0]] },
      }),
      params(orderId)
    );
    expect(response.status).toBe(403);

    // An order a Manager placed is refunded by an Administrator.
    const admin = await signInAs('admin01@meridian-corp.test');
    const byAdmin = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, { token: admin, body: { lineIds: [lineIds[0]] } }),
      params(orderId)
    );
    expect(byAdmin.status).toBe(200);
  });

  it('refuses a Manager a refund on an order placed by someone who is not their report', async () => {
    // associate03 reports to the Administrator, not to manager01.
    const outsider = await signInAs('associate03@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(outsider);

    const manager = await signInAs('manager01@meridian-corp.test');
    const response = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, { token: manager, body: { lineIds: [lineIds[0]] } }),
      params(orderId)
    );
    expect(response.status).toBe(403);
  });

  it('checks permission before the transition check', async () => {
    // An Associate refunding a Cart order sees 403, not the 409 the transition would give.
    // MR-STO-08 fixes this ordering, so the caller cannot learn an order's status by probing.
    const associate = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(associate);
    await addProduct(associate, orderId, P1);

    const response = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, { token: associate, body: { lineIds: [1] } }),
      params(orderId)
    );
    expect(response.status).toBe(403);
  });

  // MR-STO-08 as amended 2026-08-11. The frozen rule let an Administrator refund any order
  // including their own; C.1 had to decide whether to draw a Refund control on an
  // Administrator's own order and that forced the question.
  it('refuses an Administrator a refund on an order they placed themselves with 403', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const { orderId, lineIds } = await paidThreeLineOrder(admin);

    const response = await refund(
      req('POST', `/api/v1/orders/${orderId}/refund`, { token: admin, body: { lineIds: [lineIds[0]] } }),
      params(orderId)
    );

    expect(response.status).toBe(403);
    expect(statusOf(orderId)).toBe('Paid');
  });
});

describe('MR-PLT-01 order read scope', () => {
  it('lets a Manager read a direct report order and refuses one from outside their reports', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const reportOrder = await newCart(associate);

    const outsider = await signInAs('associate03@meridian-corp.test');
    const outsiderOrder = await newCart(outsider);

    const manager = await signInAs('manager01@meridian-corp.test');
    expect(
      (await readOrder(req('GET', `/api/v1/orders/${reportOrder}`, { token: manager }), params(reportOrder)))
        .status
    ).toBe(200);

    const refused = await readOrder(
      req('GET', `/api/v1/orders/${outsiderOrder}`, { token: manager }),
      params(outsiderOrder)
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).not.toHaveProperty('lines');
  });

  it('refuses an Associate another Associate order', async () => {
    const first = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(first);

    const second = await signInAs('associate02@meridian-corp.test');
    const response = await readOrder(
      req('GET', `/api/v1/orders/${orderId}`, { token: second }),
      params(orderId)
    );
    expect(response.status).toBe(403);
  });

  it('lets an Administrator read any order', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(associate);

    const admin = await signInAs('admin01@meridian-corp.test');
    expect(
      (await readOrder(req('GET', `/api/v1/orders/${orderId}`, { token: admin }), params(orderId)))
        .status
    ).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------
// The rest of the Storefront read surface. C.0 built the order lifecycle; a screen also has
// to be able to list products and list orders, and an Administrator has to be able to
// maintain stock, which MR-PLT-01 grants and MR-STO-07 constrains.

describe('GET /products', () => {
  it('is readable by every role', async () => {
    for (const email of [
      'admin01@meridian-corp.test',
      'manager01@meridian-corp.test',
      'associate01@meridian-corp.test',
    ]) {
      const token = await signInAs(email);
      const response = await listProducts(req('GET', '/api/v1/products', { token }));

      expect(response.status).toBe(200);
      const { products } = await response.json();
      expect(products).toHaveLength(9);
      expect(products[0]).toEqual({
        id: 1,
        sku: 'STO-0001',
        name: 'Harmony Studio Monitor',
        unitPriceCents: 4990,
        onHandQty: 100,
      });
    }
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await listProducts(new Request(`${BASE}/api/v1/products`));
    expect(response.status).toBe(401);
  });
});

describe('POST /products, Administrator only per MR-PLT-01', () => {
  const NEW_PRODUCT = {
    sku: 'STO-0010',
    name: 'Harmony Boom Arm',
    unitPriceCents: 3200,
    onHandQty: 5,
  };

  it('lets an Administrator create a product', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await createProduct(
      req('POST', '/api/v1/products', { token: admin, body: NEW_PRODUCT })
    );

    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(
      getDb().prepare('SELECT sku, on_hand_qty AS q FROM products WHERE id = ?').get(id)
    ).toEqual({ sku: 'STO-0010', q: 5 });
  });

  for (const account of NON_ADMIN_ROLES) {
    it(`refuses ${account.role} with 403 and creates nothing`, async () => {
      const token = await signInAs(account.email);
      const response = await createProduct(
        req('POST', '/api/v1/products', { token, body: NEW_PRODUCT })
      );

      expect(response.status).toBe(403);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 9 });
    });
  }

  it('refuses a duplicate sku with 409', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await createProduct(
      req('POST', '/api/v1/products', { token: admin, body: { ...NEW_PRODUCT, sku: 'STO-0001' } })
    );
    expect(response.status).toBe(409);
  });

  it('refuses a negative price or quantity with 422', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');

    const negativePrice = await createProduct(
      req('POST', '/api/v1/products', {
        token: admin,
        body: { ...NEW_PRODUCT, unitPriceCents: -1 },
      })
    );
    const negativeQuantity = await createProduct(
      req('POST', '/api/v1/products', { token: admin, body: { ...NEW_PRODUCT, onHandQty: -1 } })
    );

    expect(negativePrice.status).toBe(422);
    expect(negativeQuantity.status).toBe(422);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 9 });
  });
});

describe('PATCH /products/[id], stock maintenance', () => {
  it('lets an Administrator restock', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateProduct(
      req('PATCH', `/api/v1/products/${LAST_UNIT}`, { token: admin, body: { onHandQty: 12 } }),
      params(LAST_UNIT)
    );

    expect(response.status).toBe(200);
    expect(onHand(LAST_UNIT)).toBe(12);
  });

  it('lets an Administrator change a name and a price', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateProduct(
      req('PATCH', '/api/v1/products/1', {
        token: admin,
        body: { name: 'Renamed', unitPriceCents: 100 },
      }),
      params(1)
    );

    expect(response.status).toBe(200);
    expect(
      getDb().prepare('SELECT name, unit_price_cents AS p FROM products WHERE id = 1').get()
    ).toEqual({ name: 'Renamed', p: 100 });
  });

  it('does not change an order line already placed, because the line snapshots its price', async () => {
    // MR-STO-02: a line carries the unit price in effect when it was added.
    const associate = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(associate);
    await addProduct(associate, orderId, P1);

    const admin = await signInAs('admin01@meridian-corp.test');
    await updateProduct(
      req('PATCH', '/api/v1/products/1', { token: admin, body: { unitPriceCents: 100 } }),
      params(1)
    );

    const response = await readOrder(
      req('GET', `/api/v1/orders/${orderId}`, { token: associate }),
      params(orderId)
    );
    expect((await response.json()).totals.orderSubtotalCents).toBe(4990);
  });

  for (const account of NON_ADMIN_ROLES) {
    it(`refuses ${account.role} with 403 and changes no stock`, async () => {
      const token = await signInAs(account.email);
      const response = await updateProduct(
        req('PATCH', '/api/v1/products/1', { token, body: { onHandQty: 999 } }),
        params(1)
      );

      expect(response.status).toBe(403);
      expect(onHand(P1)).toBe(100);
    });
  }

  it('refuses a negative onHandQty with 422, per MR-STO-07', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateProduct(
      req('PATCH', '/api/v1/products/1', { token: admin, body: { onHandQty: -1 } }),
      params(1)
    );

    expect(response.status).toBe(422);
    expect(onHand(P1)).toBe(100);
  });

  it('accepts exactly zero, which is a real quantity and not an error', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateProduct(
      req('PATCH', '/api/v1/products/1', { token: admin, body: { onHandQty: 0 } }),
      params(1)
    );

    expect(response.status).toBe(200);
    expect(onHand(P1)).toBe(0);
  });
});

describe('GET /orders scopes exactly as GET /orders/[id] does', () => {
  async function cartFor(email: string): Promise<number> {
    const token = await signInAs(email);
    return newCart(token);
  }

  async function idsVisibleTo(email: string): Promise<number[]> {
    const token = await signInAs(email);
    const response = await listOrders(req('GET', '/api/v1/orders', { token }));
    expect(response.status).toBe(200);
    return (await response.json()).orders.map((o: { id: number }) => o.id);
  }

  it('gives an Associate only their own', async () => {
    const mine = await cartFor('associate01@meridian-corp.test');
    await cartFor('associate02@meridian-corp.test');

    expect(await idsVisibleTo('associate01@meridian-corp.test')).toEqual([mine]);
  });

  it('gives a Manager theirs and their direct reports, and nothing else', async () => {
    const report1 = await cartFor('associate01@meridian-corp.test');
    const report2 = await cartFor('associate02@meridian-corp.test');
    // associate03 reports to the Administrator, not to manager01.
    await cartFor('associate03@meridian-corp.test');
    const own = await cartFor('manager01@meridian-corp.test');

    expect(await idsVisibleTo('manager01@meridian-corp.test')).toEqual(
      [report1, report2, own].sort((a, b) => a - b)
    );
  });

  it('gives an Administrator all of them', async () => {
    const a = await cartFor('associate01@meridian-corp.test');
    const b = await cartFor('manager01@meridian-corp.test');
    const c = await cartFor('associate03@meridian-corp.test');

    expect(await idsVisibleTo('admin01@meridian-corp.test')).toEqual([a, b, c]);
  });

  it('never lists an order the detail read would refuse', async () => {
    // The list and the detail must not disagree about who may see an order. A list showing a
    // row whose detail is refused is the defect class C.2 plants deliberately, and it must
    // not arrive here by accident.
    await cartFor('associate01@meridian-corp.test');
    await cartFor('associate02@meridian-corp.test');
    await cartFor('associate03@meridian-corp.test');
    await cartFor('manager01@meridian-corp.test');

    for (const account of [
      { email: 'admin01@meridian-corp.test' },
      { email: 'manager01@meridian-corp.test' },
      { email: 'associate01@meridian-corp.test' },
    ]) {
      const token = await signInAs(account.email);
      const listed = (await (
        await listOrders(req('GET', '/api/v1/orders', { token }))
      ).json()) as { orders: { id: number }[] };

      for (const order of listed.orders) {
        const detail = await readOrder(
          req('GET', `/api/v1/orders/${order.id}`, { token }),
          params(order.id)
        );
        expect(detail.status).toBe(200);
      }
    }
  });

  it('carries the fields a list screen needs and no order lines', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const orderId = await newCart(token);
    await addProduct(token, orderId, P1);

    const response = await listOrders(req('GET', '/api/v1/orders', { token }));
    const { orders } = await response.json();

    expect(Object.keys(orders[0]).sort()).toEqual([
      'capturedAtMs',
      'id',
      'status',
      'totalCents',
      'userId',
    ]);
    // One $49.90 line, no code: tax 49.90 x 0.0825 = 4.11675 to $4.12, shipping $12.00.
    expect(orders[0]).toMatchObject({ id: orderId, userId: 3, status: 'Cart', totalCents: 6602 });
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await listOrders(new Request(`${BASE}/api/v1/orders`));
    expect(response.status).toBe(401);
  });
});
