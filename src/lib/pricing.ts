// Storefront arithmetic. Every value here is an integer number of cents, and no expression
// in this file produces a fractional JavaScript number, per MR-STO-01: amounts are computed
// in integer cents or a decimal type, never in binary floating point.
//
// MR-STO-02 fixes the order of composition and it matters. Discount before tax, tax once at
// order level on the discounted subtotal, shipping decided on the discounted subtotal and
// never taxed.

/** MR-STO-02 step 5. 8.25%, held as basis points so the rate itself stays an integer. */
export const TAX_RATE_BASIS_POINTS = 825;
const BASIS_POINT_SCALE = 10000;

/** MR-STO-02 step 6 and MR-STO-05. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 20000;
export const FLAT_SHIPPING_CENTS = 1200;

export interface PriceableLine {
  unitPriceCents: number;
  quantity: number;
}

export interface OrderTotals {
  orderSubtotalCents: number;
  discountCents: number;
  discountedSubtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
}

/**
 * Divides two integers, rounding half-up away from zero, per MR-STO-01.
 *
 * The whole calculation stays in integers: `(2n + d) / 2d` floored is exactly "round half
 * away from zero" when n and d are non-negative, and the sign is handled separately so a
 * negative tie goes away from zero rather than towards it. Written this way rather than as
 * Math.round on a quotient because Math.round breaks on negatives (it rounds half up towards
 * positive infinity, so -0.5 becomes -0) and because a float quotient reintroduces exactly
 * the representation error MR-STO-01 exists to exclude.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const magnitude = Math.abs(numerator);
  return sign * Math.floor((2 * magnitude + denominator) / (2 * denominator));
}

/** MR-STO-02 steps 1 and 2. Exact, no rounding. */
function orderSubtotal(lines: readonly PriceableLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

/** MR-STO-02 step 3. Rounded half-up, applied to the order subtotal, before tax. */
function discountAmount(orderSubtotalCents: number, ratePercent: number): number {
  if (ratePercent === 0) return 0;
  return roundHalfUp(orderSubtotalCents * ratePercent, 100);
}

/** MR-STO-02 step 5. Computed once, at order level, on the discounted subtotal. */
function taxAmount(discountedSubtotalCents: number): number {
  return roundHalfUp(discountedSubtotalCents * TAX_RATE_BASIS_POINTS, BASIS_POINT_SCALE);
}

/** MR-STO-02 step 6 and MR-STO-05. Tested against the discounted subtotal, inclusive at $200.00. */
function shippingAmount(discountedSubtotalCents: number): number {
  // MR-STO-05: exactly $200.00 qualifies, so the comparison is >= and not >.
  return discountedSubtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}

/** MR-STO-02, composed in the order the rule states. */
export function computeTotals(lines: readonly PriceableLine[], ratePercent: number): OrderTotals {
  const orderSubtotalCents = orderSubtotal(lines);
  const discountCents = discountAmount(orderSubtotalCents, ratePercent);
  const discountedSubtotalCents = orderSubtotalCents - discountCents;

  // MR-STO-02 step 5: tax is computed on the discounted subtotal, never the pre-discount one.
  const taxCents = taxAmount(discountedSubtotalCents);

  // MR-STO-05: the free-shipping threshold is tested against the discounted subtotal, so a
  // discount can move an order back into paid shipping.
  const shippingCents = shippingAmount(discountedSubtotalCents);

  return {
    orderSubtotalCents,
    discountCents,
    discountedSubtotalCents,
    taxCents,
    shippingCents,
    totalCents: discountedSubtotalCents + taxCents + shippingCents,
  };
}

/**
 * MR-STO-08. Recomputes the order total over the lines that remain unrefunded, under the
 * rule's two constraints: shipping is held at the amount captured on the original order and
 * is never recomputed against the free-shipping threshold, and shipping is refunded only on
 * the refund that leaves no unrefunded lines.
 *
 * The refund amount is the difference between the current captured total and this value, so
 * the sequence of refunds sums to exactly the captured total with no residue. Refunding each
 * line at its own discounted price plus its own tax is the alternative that does not, and it
 * over-refunds by a cent that no screen displays.
 */
export function recomputeRemainingTotal(
  remainingLines: readonly PriceableLine[],
  ratePercent: number,
  capturedShippingCents: number
): number {
  if (remainingLines.length === 0) return 0;

  const orderSubtotalCents = orderSubtotal(remainingLines);
  const discountCents = discountAmount(orderSubtotalCents, ratePercent);
  const discountedSubtotalCents = orderSubtotalCents - discountCents;

  return discountedSubtotalCents + taxAmount(discountedSubtotalCents) + capturedShippingCents;
}

/** MR-STO-03. Boundary values for the rate are 0, 1, 50, and 51. */
export function isValidDiscountRate(ratePercent: number): boolean {
  return Number.isInteger(ratePercent) && ratePercent >= 1 && ratePercent <= 50;
}

/**
 * The UTC calendar date an instant falls on.
 *
 * MR-STO-03 and MR-STO-08 both compare an instant against a date without naming a timezone.
 * UTC is the reading this skeleton chose; see the ambiguity log.
 */
export function utcDate(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

/** Whole days between the UTC calendar dates of two instants. */
export function wholeDaysBetween(fromMs: number, toMs: number): number {
  const day = 24 * 60 * 60 * 1000;
  const fromMidnight = Date.parse(`${utcDate(fromMs)}T00:00:00.000Z`);
  const toMidnight = Date.parse(`${utcDate(toMs)}T00:00:00.000Z`);
  return Math.round((toMidnight - fromMidnight) / day);
}

/** MR-STO-03. Usable on and including the expiry date, unusable the day after. */
export function isCodeUsableOn(
  code: { active: number; expiresOn: string },
  atMs: number
): boolean {
  if (code.active !== 1) return false;
  return utcDate(atMs) <= code.expiresOn;
}
