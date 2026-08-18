import { getDb, inTransaction } from '../db/index';
import { isDirectReport } from './authz';
import { conflict, forbidden, notFound, unprocessable } from './errors';
import {
  type PriceableLine,
  computeTotals,
  isCodeUsableOn,
  recomputeRemainingTotal,
  wholeDaysBetween,
} from './pricing';
import type { CaptureOutcome, OrderStatus } from '../shared/types';
import type { Principal } from './session';

// Declared in src/shared/types.ts, re-exported here so the interface and the server share
// one definition without the interface importing this module.
export type { CaptureOutcome, OrderStatus };

export interface OrderRow {
  id: number;
  user_id: number;
  status: OrderStatus;
  discount_code_id: number | null;
  captured_total_cents: number | null;
  captured_shipping_cents: number | null;
  captured_at_ms: number | null;
}

export interface OrderLineRow {
  id: number;
  order_id: number;
  product_id: number;
  unit_price_cents: number;
  quantity: number;
  refunded_at_ms: number | null;
}

/** MR-STO-08. Day 10 is accepted, day 11 is rejected. */
export const REFUND_WINDOW_DAYS = 10;

/**
 * MR-STO-06's transition table, as data rather than as a chain of conditionals, so that
 * "every transition not listed above is invalid" is enforced by the absence of a row rather
 * than by remembering to write an else.
 *
 * The two refund events share a source and differ only in destination, which the rule
 * decides by whether any line remains unrefunded, so refund() computes its destination and
 * then checks it here like any other transition.
 */
const TRANSITIONS: ReadonlyArray<{ from: OrderStatus; to: OrderStatus }> = [
  { from: 'Cart', to: 'Pending Payment' },
  { from: 'Cart', to: 'Cancelled' },
  { from: 'Pending Payment', to: 'Paid' },
  { from: 'Pending Payment', to: 'Payment Failed' },
  { from: 'Pending Payment', to: 'Cancelled' },
  { from: 'Payment Failed', to: 'Pending Payment' },
  { from: 'Payment Failed', to: 'Cancelled' },
  { from: 'Paid', to: 'Partially Refunded' },
  { from: 'Paid', to: 'Refunded' },
  { from: 'Partially Refunded', to: 'Partially Refunded' },
  { from: 'Partially Refunded', to: 'Refunded' },
];

function assertTransitionAllowed(from: OrderStatus, to: OrderStatus): void {
  const allowed = TRANSITIONS.some((t) => t.from === from && t.to === to);
  if (!allowed) {
    // MR-STO-06: rejected with HTTP 409, status unchanged, no money moves, no inventory moves.
    throw conflict(`Order cannot move from ${from} to ${to}`);
  }
}

export function loadOrder(orderId: number): OrderRow {
  const row = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
    | OrderRow
    | undefined;
  if (row === undefined) throw notFound('No such order');
  return row;
}

export function loadLines(orderId: number): OrderLineRow[] {
  return getDb()
    .prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY id')
    .all(orderId) as OrderLineRow[];
}

function ratePercentFor(order: OrderRow): number {
  if (order.discount_code_id === null) return 0;
  const code = getDb()
    .prepare('SELECT rate_percent FROM discount_codes WHERE id = ?')
    .get(order.discount_code_id) as { rate_percent: number } | undefined;
  return code?.rate_percent ?? 0;
}

const priceable = (lines: readonly OrderLineRow[]): PriceableLine[] =>
  lines.map((l) => ({ unitPriceCents: l.unit_price_cents, quantity: l.quantity }));

/** MR-PLT-01 read scope. A Manager sees their own orders and their direct reports'. */
export function canReadOrder(principal: Principal, order: OrderRow): boolean {
  if (principal.role === 'Administrator') return true;
  if (order.user_id === principal.userId) return true;
  if (principal.role === 'Manager') return isDirectReport(principal.userId, order.user_id);
  return false;
}

export function assertCanReadOrder(principal: Principal, order: OrderRow): void {
  if (!canReadOrder(principal, order)) throw forbidden('Not permitted to read this order');
}

/**
 * MR-STO-06's write lock. Order contents are editable only in Cart, and a write attempted in
 * any other status is rejected with 409 and changes nothing, including a write that would set
 * an identical value.
 */
function assertEditable(order: OrderRow): void {
  // MR-STO-06: order contents are editable only while the status is Cart.
  if (order.status !== 'Cart') {
    throw conflict(`Order contents are editable only in Cart, not in ${order.status}`);
  }
}

export function createCart(userId: number): number {
  const result = getDb()
    .prepare("INSERT INTO orders (user_id, status) VALUES (?, 'Cart')")
    .run(userId);
  return Number(result.lastInsertRowid);
}

/**
 * Adds a product to an order.
 *
 * The unit price is snapshotted here rather than read at checkout, and adding a product
 * already on the order increments that line rather than creating a second one. Neither is
 * stated by MR-STO-02; both are in the ambiguity log.
 */
export function addLine(order: OrderRow, productId: number, quantity: number): void {
  assertEditable(order);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw unprocessable('Quantity must be a positive integer');
  }

  const product = getDb()
    .prepare('SELECT id, unit_price_cents FROM products WHERE id = ?')
    .get(productId) as { id: number; unit_price_cents: number } | undefined;
  if (product === undefined) throw unprocessable('No such product');

  const existing = getDb()
    .prepare('SELECT id, quantity FROM order_lines WHERE order_id = ? AND product_id = ?')
    .get(order.id, productId) as { id: number; quantity: number } | undefined;

  if (existing !== undefined) {
    getDb()
      .prepare('UPDATE order_lines SET quantity = ? WHERE id = ?')
      .run(existing.quantity + quantity, existing.id);
    return;
  }

  getDb()
    .prepare(
      'INSERT INTO order_lines (order_id, product_id, unit_price_cents, quantity) VALUES (?, ?, ?, ?)'
    )
    .run(order.id, productId, product.unit_price_cents, quantity);
}

/**
 * MR-STO-03. At most one code per order: a second code replaces the first rather than
 * stacking, and the recalculated total reflects only the surviving code.
 */
export function applyDiscountCode(order: OrderRow, codeText: string, nowMs: number): void {
  assertEditable(order);

  const code = getDb()
    .prepare('SELECT id, rate_percent, active, expires_on FROM discount_codes WHERE code = ?')
    .get(codeText) as
    | { id: number; rate_percent: number; active: number; expires_on: string }
    | undefined;
  if (code === undefined) throw unprocessable('No such discount code');
  if (!isCodeUsableOn({ active: code.active, expiresOn: code.expires_on }, nowMs)) {
    throw unprocessable('Discount code is not usable');
  }

  getDb().prepare('UPDATE orders SET discount_code_id = ? WHERE id = ?').run(code.id, order.id);
}

export function totalsFor(order: OrderRow): ReturnType<typeof computeTotals> {
  return computeTotals(priceable(loadLines(order.id)), ratePercentFor(order));
}

function assertEveryLineAvailable(lines: readonly OrderLineRow[]): void {
  const read = getDb().prepare('SELECT on_hand_qty FROM products WHERE id = ?');
  for (const line of lines) {
    const product = read.get(line.product_id) as { on_hand_qty: number } | undefined;
    if (product === undefined || product.on_hand_qty < line.quantity) {
      throw new OutOfStockError(line.product_id);
    }
  }
}

export class OutOfStockError extends Error {
  constructor(readonly productId: number) {
    super(`Product ${productId} is out of stock`);
    this.name = 'OutOfStockError';
  }
}

/**
 * MR-STO-06 Cart to Pending Payment, guarded on every line's quantity being available on
 * hand. MR-STO-07: this checks availability and does not reserve it.
 */
export function submitCheckout(order: OrderRow): void {
  assertTransitionAllowed(order.status, 'Pending Payment');

  const lines = loadLines(order.id);
  if (lines.length === 0) throw unprocessable('An order must hold at least one line to check out');

  try {
    assertEveryLineAvailable(lines);
  } catch (error) {
    if (error instanceof OutOfStockError) throw conflict(error.message);
    throw error;
  }

  // MR-STO-07: checkout submission checks availability but moves no stock. The decrement
  // happens only on capture success, in the same transaction as the Paid write.
  getDb().prepare("UPDATE orders SET status = 'Pending Payment' WHERE id = ?").run(order.id);
}

/** MR-STO-06 Payment Failed to Pending Payment, under the same availability guard. */
export function retryPayment(order: OrderRow): void {
  assertTransitionAllowed(order.status, 'Pending Payment');
  try {
    assertEveryLineAvailable(loadLines(order.id));
  } catch (error) {
    if (error instanceof OutOfStockError) throw conflict(error.message);
    throw error;
  }
  getDb().prepare("UPDATE orders SET status = 'Pending Payment' WHERE id = ?").run(order.id);
}

export function cancel(order: OrderRow): void {
  assertTransitionAllowed(order.status, 'Cancelled');
  getDb().prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(order.id);
}

export interface CaptureResult {
  status: OrderStatus;
  reason?: 'out_of_stock' | 'declined';
  capturedTotalCents?: number;
}

/**
 * MR-STO-07. The inventory decrement and the Paid write are in one database transaction, so
 * a successful capture paired with a failed decrement cannot happen: the transaction rolls
 * back and the customer is not charged.
 *
 * The third MR-STO-06 row, "capture succeeds but a line went out of stock first", is the
 * catch below. The decrement is rolled back, no money is taken, and the order lands in
 * Payment Failed like any other failed capture.
 *
 * `outcome` stands in for the payment gateway. Nothing in the specification says what makes
 * a capture succeed or decline, which a facilitator needs in order to demonstrate the
 * declined path; see the ambiguity log.
 */
export function capture(order: OrderRow, outcome: CaptureOutcome, nowMs: number): CaptureResult {
  if (outcome === 'decline') {
    assertTransitionAllowed(order.status, 'Payment Failed');
    getDb().prepare("UPDATE orders SET status = 'Payment Failed' WHERE id = ?").run(order.id);
    return { status: 'Payment Failed', reason: 'declined' };
  }

  assertTransitionAllowed(order.status, 'Paid');

  try {
    return inTransaction(() => {
      const lines = loadLines(order.id);
      assertEveryLineAvailable(lines);

      const decrement = getDb().prepare(
        'UPDATE products SET on_hand_qty = on_hand_qty - ? WHERE id = ?'
      );
      for (const line of lines) decrement.run(line.quantity, line.product_id);

      const totals = computeTotals(priceable(lines), ratePercentFor(order));
      getDb()
        .prepare(
          `UPDATE orders
              SET status = 'Paid', captured_total_cents = ?, captured_shipping_cents = ?,
                  captured_at_ms = ?
            WHERE id = ?`
        )
        .run(totals.totalCents, totals.shippingCents, nowMs, order.id);

      return { status: 'Paid' as OrderStatus, capturedTotalCents: totals.totalCents };
    });
  } catch (error) {
    if (error instanceof OutOfStockError) {
      // The transaction above rolled back, so no stock moved and no money was taken. The
      // order still records the failed attempt.
      getDb().prepare("UPDATE orders SET status = 'Payment Failed' WHERE id = ?").run(order.id);
      return { status: 'Payment Failed', reason: 'out_of_stock' };
    }
    throw error;
  }
}

/**
 * MR-STO-08 authority, stated in the same terms MR-PLT-01 uses.
 *
 * A Manager's refund scope is a strict subset of their order-read scope, so a Manager can
 * never refund an order they are not permitted to read.
 */
export function canRefundOrder(principal: Principal, order: OrderRow): boolean {
  // MR-STO-08, as amended 2026-08-11. Nobody refunds an order they placed themselves,
  // whatever their role: it would let one person both receive the money and authorise its
  // movement, which is the same reason MR-INV-02 blocks self-approval. This is first because
  // it applies to all three roles, including the Administrator the frozen rule exempted.
  if (order.user_id === principal.userId) return false;
  if (principal.role === 'Administrator') return true;
  if (principal.role === 'Associate') return false;
  // Manager. A direct report's order.
  return isDirectReport(principal.userId, order.user_id);
}

export interface RefundResult {
  status: OrderStatus;
  refundCents: number;
}

/**
 * MR-STO-08. Requesting and executing a refund are one action: the status transition, the
 * money movement, and the restock all fire together.
 *
 * Check order is fixed by the rule. Permission is checked before any transition check, per
 * MR-PLT-02, so a caller whose role does not permit a refund on that order is refused with
 * 403 whatever status the order is in.
 */
export function refund(
  principal: Principal,
  order: OrderRow,
  lineIds: readonly number[],
  nowMs: number
): RefundResult {
  if (!canRefundOrder(principal, order)) {
    throw forbidden('Not permitted to refund this order');
  }

  if (order.captured_at_ms === null || order.captured_total_cents === null) {
    throw conflict(`Order in ${order.status} has no captured payment to refund`);
  }
  if (wholeDaysBetween(order.captured_at_ms, nowMs) > REFUND_WINDOW_DAYS) {
    // The rule states the boundary but not the code for missing it; see the ambiguity log.
    throw unprocessable(`A refund must be executed within ${REFUND_WINDOW_DAYS} days of capture`);
  }

  const lines = loadLines(order.id);
  const targeted = lines.filter((l) => lineIds.includes(l.id));
  if (targeted.length !== lineIds.length) throw unprocessable('A line does not belong to this order');
  if (targeted.length === 0) throw unprocessable('A refund must target at least one line');
  if (targeted.some((l) => l.refunded_at_ms !== null)) {
    throw conflict('A targeted line is already refunded');
  }

  const remaining = lines.filter(
    (l) => l.refunded_at_ms === null && !lineIds.includes(l.id)
  );
  const destination: OrderStatus = remaining.length > 0 ? 'Partially Refunded' : 'Refunded';
  assertTransitionAllowed(order.status, destination);

  return inTransaction(() => {
    const recomputed = recomputeRemainingTotal(
      priceable(remaining),
      ratePercentFor(order),
      order.captured_shipping_cents ?? 0
    );
    // MR-STO-08: the refund amount is the difference between the captured total and the
    // total recomputed over the remaining lines, never each line priced on its own, so a
    // refund sequence sums to exactly the captured total with no residue.
    const refundCents = (order.captured_total_cents as number) - recomputed;

    const markRefunded = getDb().prepare('UPDATE order_lines SET refunded_at_ms = ? WHERE id = ?');
    const restock = getDb().prepare(
      'UPDATE products SET on_hand_qty = on_hand_qty + ? WHERE id = ?'
    );
    for (const line of targeted) {
      markRefunded.run(nowMs, line.id);
      // Restocking is immediate.
      restock.run(line.quantity, line.product_id);
    }

    getDb()
      .prepare('UPDATE orders SET status = ?, captured_total_cents = ? WHERE id = ?')
      .run(destination, recomputed, order.id);

    return { status: destination, refundCents };
  });
}
