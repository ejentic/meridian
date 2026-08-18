import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { EMAIL, expectRefusedBothWays, resetFixture, signInAs, tokenFor } from './support/paired';

// MR-STO-02 through MR-STO-08 in a browser. The arithmetic already passes in the Vitest
// suite; what these add is that the numbers a person reads off the screen are the same ones,
// composed line by line, which is what MR-STO-04's truncation trap needs to be visible.

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

/** The three seeded $49.90 products MR-STO-02's worked example is built from. */
const WORKED_EXAMPLE_SKUS = ['STO-0001', 'STO-0002', 'STO-0003'];

/**
 * Clicks Add to cart and waits for the screen to confirm that one.
 *
 * The wait is not politeness. A click returns as soon as it is dispatched, so navigating on
 * the click alone leaves the request in flight and the navigation cancels it, and the cart
 * then holds fewer lines than were clicked. That is a test racing the application, and it
 * would report a wrong total rather than a missing line.
 */
async function addToCart(page: Page, sku: string): Promise<void> {
  await page.getByRole('row', { name: new RegExp(sku) }).getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId('added')).toContainText(sku);
}

async function buildWorkedExampleCart(page: Page): Promise<void> {
  await page.goto('/products');
  for (const sku of WORKED_EXAMPLE_SKUS) {
    await addToCart(page, sku);
  }

  await page.goto('/cart');
  await page.getByLabel('Discount code').fill('SAVE10');
  await page.getByRole('button', { name: 'Apply code' }).click();
  // The totals below are what the server composed. Waiting for the discounted figure keeps
  // checkout from being clicked while the code is still being applied.
  await expect(page.getByTestId('discount')).toHaveText('-$14.97');
}

/** Drives an order to Paid or Payment Failed and returns its id. */
async function checkoutAndCapture(page: Page, outcome: 'Capture success' | 'Capture decline'): Promise<string> {
  await page.getByRole('button', { name: 'Check out' }).click();
  await expect(page).toHaveURL(/\/orders\/\d+/);

  const orderId = /\/orders\/(\d+)/.exec(page.url())![1];
  await page.getByRole('button', { name: outcome }).click();
  return orderId;
}

test('shows the MR-STO-02 breakdown line by line, not as a single total', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);

  // Every composed line, because MR-STO-04's truncation case reaches the correct total by
  // two compensating errors. A screen showing only the total cannot distinguish it.
  await expect(page.getByTestId('order-subtotal')).toHaveText('$149.70');
  await expect(page.getByTestId('discount')).toHaveText('-$14.97');
  await expect(page.getByTestId('discounted-subtotal')).toHaveText('$134.73');
  await expect(page.getByTestId('tax')).toHaveText('$11.12');
  await expect(page.getByTestId('shipping')).toHaveText('$12.00');
  await expect(page.getByTestId('total')).toHaveText('$157.85');
});

test('takes the worked example cart to Paid at the published total', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);

  await checkoutAndCapture(page, 'Capture success');

  await expect(page.getByTestId('order-status')).toHaveText('Paid');
  await expect(page.getByTestId('captured-total')).toHaveText('$157.85');
});

test('MR-STO-05: a discount that drops the subtotal below $200.00 restores the shipping charge', async ({
  page,
}) => {
  await signInAs(page, EMAIL.associate);
  await page.goto('/products');
  await addToCart(page, 'STO-0005');

  await page.goto('/cart');
  await page.getByLabel('Discount code').fill('SAVE10');
  await page.getByRole('button', { name: 'Apply code' }).click();

  // MR-STO-05's own worked case. The threshold is tested against the discounted subtotal, so
  // $210.00 clearing $200.00 before the code is applied does not earn free shipping. The two
  // lines are asserted together because either one alone is a value the rule permits somewhere.
  await expect(page.getByTestId('discounted-subtotal')).toHaveText('$189.00');
  await expect(page.getByTestId('shipping')).toHaveText('$12.00');
});

test('MR-STO-05: a discounted subtotal of exactly $200.00 ships free', async ({ page, request }) => {
  // Composed over the API because the products screen adds one unit per click, and this cart
  // needs thirteen. Clicking the same row repeatedly would also mean waiting on a confirmation
  // banner that already names that SKU, which is a wait that cannot fail.
  const token = await tokenFor(request, EMAIL.associate);
  const cookie = `meridian_session=${token}`;
  const created = await request.post('/api/v1/orders', { headers: { cookie } });
  const { orderId } = (await created.json()) as { orderId: number };

  // 1 x $49.90 + 2 x $14.55 + 10 x $12.10 = $200.00 exactly, with no code applied.
  for (const line of [
    { productId: 1, quantity: 1 },
    { productId: 4, quantity: 2 },
    { productId: 6, quantity: 10 },
  ]) {
    const response = await request.post(`/api/v1/orders/${orderId}/lines`, {
      headers: { cookie },
      data: line,
    });
    expect(response.status()).toBe(200);
  }

  await signInAs(page, EMAIL.associate);
  await page.goto('/cart');

  // MR-STO-05 states that exactly $200.00 qualifies, so the boundary is inclusive. The
  // subtotal is asserted alongside the shipping line, because a shipping charge of $0.00 only
  // means something once the cart is known to sit exactly on the boundary.
  await expect(page.getByTestId('order-subtotal')).toHaveText('$200.00');
  await expect(page.getByTestId('shipping')).toHaveText('$0.00');
});

test('a declined capture lands in Payment Failed and moves no stock', async ({ page, request }) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);

  await checkoutAndCapture(page, 'Capture decline');

  await expect(page.getByTestId('order-status')).toHaveText('Payment Failed');
  await expect(page.getByTestId('captured-total')).toHaveCount(0);

  // MR-STO-07: on-hand quantity is unchanged when capture declines.
  await page.goto('/products');
  for (const sku of WORKED_EXAMPLE_SKUS) {
    await expect(page.getByRole('row', { name: new RegExp(sku) })).toContainText('100');
  }
});

test('hides every content control once the order leaves Cart, per MR-STO-06', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);
  await page.getByRole('button', { name: 'Check out' }).click();
  await expect(page).toHaveURL(/\/orders\/\d+/);

  await page.goto('/cart');
  // The cart is empty again: the order that was the cart is now in Pending Payment, and
  // order contents are editable only in Cart.
  await expect(page.getByRole('button', { name: 'Apply code' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(0);
});

test('MR-STO-06: a line write outside Cart is refused with 409', async ({ page, request }) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);
  await page.getByRole('button', { name: 'Check out' }).click();
  await expect(page).toHaveURL(/\/orders\/\d+/);
  const orderId = /\/orders\/(\d+)/.exec(page.url())![1];

  // The enforcement half of the pair above. That test asserts the cart screen draws no
  // content controls, which it cannot help doing once the order has left Cart, because the
  // screen only ever loads an order in Cart. MR-STO-06's actual claim is that the write is
  // refused, and only a direct call makes it.
  const token = await tokenFor(request, EMAIL.associate);
  const response = await request.post(`/api/v1/orders/${orderId}/lines`, {
    headers: { cookie: `meridian_session=${token}` },
    data: { productId: 4, quantity: 1 },
  });
  expect(response.status()).toBe(409);
});

test('offers no add-to-cart on a product with nothing on hand', async ({ page, request }) => {
  // Drain the single unit of STO-0009 first, which is the seeded last-unit case.
  await signInAs(page, EMAIL.associate);
  await page.goto('/products');
  await addToCart(page, 'STO-0009');
  await page.goto('/cart');
  await checkoutAndCapture(page, 'Capture success');

  await page.goto('/products');
  const lastUnitRow = page.getByRole('row', { name: /STO-0009/ });
  await expect(lastUnitRow).toContainText('0');
  await expect(lastUnitRow.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
});

test('lists an order for its owner and refuses one placed by somebody else', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);
  const orderId = await checkoutAndCapture(page, 'Capture success');

  await page.goto('/orders');
  await expect(page.getByRole('row', { name: new RegExp(`^${orderId} `) })).toBeVisible();

  // associate02 is a peer, not a manager, so MR-PLT-01 gives them nothing on this order.
  await signInAs(page, EMAIL.associate2);
  await page.goto('/orders');
  await expect(page.getByRole('row', { name: new RegExp(`^${orderId} `) })).toHaveCount(0);

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId('error-banner')).toContainText('403');
});

test('a Manager refunds a direct report order and the amounts match the published sequence', async ({
  page,
}) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);
  const orderId = await checkoutAndCapture(page, 'Capture success');

  await signInAs(page, EMAIL.manager);
  await page.goto(`/orders/${orderId}`);

  const refundButtons = page.getByRole('button', { name: 'Refund line' });
  await expect(refundButtons).toHaveCount(3);

  await refundButtons.first().click();
  await expect(page.getByTestId('order-status')).toHaveText('Partially Refunded');
  await expect(page.getByTestId('captured-total')).toHaveText('$109.23');

  await page.getByRole('button', { name: 'Refund line' }).first().click();
  await expect(page.getByTestId('captured-total')).toHaveText('$60.62');

  await page.getByRole('button', { name: 'Refund line' }).first().click();
  await expect(page.getByTestId('order-status')).toHaveText('Refunded');
});

test('MR-STO-08: the refund sequence sums to exactly the captured total', async ({
  page,
  request,
}) => {
  await signInAs(page, EMAIL.associate);
  await buildWorkedExampleCart(page);
  const orderId = await checkoutAndCapture(page, 'Capture success');
  await expect(page.getByTestId('captured-total')).toHaveText('$157.85');

  const token = await tokenFor(request, EMAIL.manager);
  const cookie = `meridian_session=${token}`;
  const detail = await request.get(`/api/v1/orders/${orderId}`, { headers: { cookie } });
  const { lines } = (await detail.json()) as { lines: { id: number }[] };

  const amounts: number[] = [];
  for (const line of lines) {
    const response = await request.post(`/api/v1/orders/${orderId}/refund`, {
      headers: { cookie },
      data: { lineIds: [line.id] },
    });
    expect(response.status()).toBe(200);
    amounts.push(((await response.json()) as { refundCents: number }).refundCents);
  }

  // MR-STO-08's stated invariant: the total is recomputed over the lines that remain and the
  // difference is refunded, so the sequence sums to the captured total with no residue. The
  // spec above watches the captured total fall, which is the same whichever method is used;
  // the amounts themselves are what distinguish the rule's method from the naive one, and
  // they are in the response rather than on any screen.
  expect(amounts).toEqual([4862, 4861, 6062]);
  expect(amounts.reduce((a, b) => a + b, 0)).toBe(15785);
});

// MR-STO-08 paired tests, one per role the amended rule refuses. Each asserts the Refund
// control is absent AND that the endpoint refuses the same caller, because the interface and
// the API decide this independently and can disagree.

async function paidOrderPlacedBy(page: Page, request: APIRequestContext, email: string): Promise<string> {
  await signInAs(page, email);
  await buildWorkedExampleCart(page);
  return checkoutAndCapture(page, 'Capture success');
}

async function firstLineIdOf(request: APIRequestContext, orderId: string, email: string): Promise<number> {
  const token = await tokenFor(request, email);
  const response = await request.get(`/api/v1/orders/${orderId}`, {
    headers: { cookie: `meridian_session=${token}` },
  });
  const body = (await response.json()) as { lines: { id: number }[] };
  return body.lines[0].id;
}

test('MR-STO-08: an Associate gets no refund control on their own order, both ways', async ({
  page,
  request,
}) => {
  const orderId = await paidOrderPlacedBy(page, request, EMAIL.associate);
  const lineId = await firstLineIdOf(request, orderId, EMAIL.admin);

  await page.goto(`/orders/${orderId}`);
  // Anchor on the heading, not on the status: a caller MR-PLT-01 does not let read this
  // order sees a 403 and no status at all, which is correct. What the anchor has to prove is
  // that the screen rendered, so an absent Refund line control is a decision and not a page
  // that never loaded.
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toBeVisible();

  await expectRefusedBothWays(page, request, {
    email: EMAIL.associate,
    controlName: 'Refund line',
    method: 'post',
    path: `/orders/${orderId}/refund`,
    body: { lineIds: [lineId] },
    expectedStatus: 403,
  });
});

test('MR-STO-08: a Manager gets no refund control on an order they placed, both ways', async ({
  page,
  request,
}) => {
  const orderId = await paidOrderPlacedBy(page, request, EMAIL.manager);
  const lineId = await firstLineIdOf(request, orderId, EMAIL.admin);

  await page.goto(`/orders/${orderId}`);
  // Anchor on the heading, not on the status: a caller MR-PLT-01 does not let read this
  // order sees a 403 and no status at all, which is correct. What the anchor has to prove is
  // that the screen rendered, so an absent Refund line control is a decision and not a page
  // that never loaded.
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toBeVisible();

  await expectRefusedBothWays(page, request, {
    email: EMAIL.manager,
    controlName: 'Refund line',
    method: 'post',
    path: `/orders/${orderId}/refund`,
    body: { lineIds: [lineId] },
    expectedStatus: 403,
  });
});

test('MR-STO-08 as amended: an Administrator gets no refund control on their own order, both ways', async ({
  page,
  request,
}) => {
  // The 2026-08-11 amendment, seen through the interface. Before it, this control was drawn
  // and the endpoint allowed it, which is the asymmetry Phase A flagged and C.1 forced.
  const orderId = await paidOrderPlacedBy(page, request, EMAIL.admin);
  const lineId = await firstLineIdOf(request, orderId, EMAIL.admin);

  await page.goto(`/orders/${orderId}`);
  // Anchor on the heading, not on the status: a caller MR-PLT-01 does not let read this
  // order sees a 403 and no status at all, which is correct. What the anchor has to prove is
  // that the screen rendered, so an absent Refund line control is a decision and not a page
  // that never loaded.
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toBeVisible();

  await expectRefusedBothWays(page, request, {
    email: EMAIL.admin,
    controlName: 'Refund line',
    method: 'post',
    path: `/orders/${orderId}/refund`,
    body: { lineIds: [lineId] },
    expectedStatus: 403,
  });
});

test('a Manager gets no refund control on an order outside their direct reports, both ways', async ({
  page,
  request,
}) => {
  // associate03 reports to the Administrator, not to manager01.
  const orderId = await paidOrderPlacedBy(page, request, EMAIL.outsider);
  const lineId = await firstLineIdOf(request, orderId, EMAIL.admin);

  await signInAs(page, EMAIL.manager);
  await page.goto(`/orders/${orderId}`);
  // Anchor on the heading, not on the status: a caller MR-PLT-01 does not let read this
  // order sees a 403 and no status at all, which is correct. What the anchor has to prove is
  // that the screen rendered, so an absent Refund line control is a decision and not a page
  // that never loaded.
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toBeVisible();

  await expectRefusedBothWays(page, request, {
    email: EMAIL.manager,
    controlName: 'Refund line',
    method: 'post',
    path: `/orders/${orderId}/refund`,
    body: { lineIds: [lineId] },
    expectedStatus: 403,
  });
});

// Administrator product and stock maintenance, per MR-PLT-01.

test('lets an Administrator create a product and restock one', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/admin/products');

  await page.getByLabel('SKU').fill('STO-0010');
  await page.getByLabel('Name').fill('Harmony Boom Arm');
  await page.getByLabel('Unit price in cents').fill('3200');
  await page.getByLabel('On hand').fill('5');
  await page.getByRole('button', { name: 'Create product' }).click();

  await expect(page.getByRole('row', { name: /STO-0010/ })).toContainText('Harmony Boom Arm');

  await page.getByRole('row', { name: /STO-0009/ }).getByLabel('Stock').fill('12');
  await page.getByRole('row', { name: /STO-0009/ }).getByRole('button', { name: 'Save stock' }).click();
  // Wait for the write to come back before reloading. Reloading on the click alone cancels
  // the request in flight and then asserts against the value it just discarded.
  await expect(page.getByTestId('saved')).toContainText('STO-0009');

  await page.reload();
  await expect(page.getByRole('row', { name: /STO-0009/ }).getByLabel('Stock')).toHaveValue('12');
});

test('shows the 422 when stock is set below zero, per MR-STO-07', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/admin/products');

  await page.getByRole('row', { name: /STO-0001/ }).getByLabel('Stock').fill('-1');
  await page.getByRole('row', { name: /STO-0001/ }).getByRole('button', { name: 'Save stock' }).click();

  await expect(page.getByTestId('error-banner')).toContainText('422');
});

for (const role of [
  { name: 'Manager', email: EMAIL.manager },
  { name: 'Associate', email: EMAIL.associate },
]) {
  test(`refuses ${role.name} product maintenance, both ways`, async ({ page, request }) => {
    await signInAs(page, role.email);
    await page.goto('/admin/products');
    // Anchor: the screen rendered and said why the form is not there, so the absent Create
    // product control is a decision rather than a page that failed to load.
    await expect(page.getByText('Product and stock maintenance is Administrator only.')).toBeVisible();

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'Create product',
      method: 'post',
      path: '/products',
      body: { sku: 'STO-0011', name: 'Nope', unitPriceCents: 100, onHandQty: 1 },
      expectedStatus: 403,
    });
  });

  test(`refuses ${role.name} the product maintenance nav entry`, async ({ page, request }) => {
    await signInAs(page, role.email);
    // Anchor: the shell rendered, so an absent ADMIN entry is an absent entry.
    await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'Product maintenance',
      controlRole: 'link',
      method: 'patch',
      path: '/products/1',
      body: { onHandQty: 999 },
      expectedStatus: 403,
    });
  });
}
