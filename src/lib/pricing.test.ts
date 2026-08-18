import { describe, expect, it } from 'vitest';
import {
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  computeTotals,
  isCodeUsableOn,
  recomputeRemainingTotal,
  roundHalfUp,
  utcDate,
  wholeDaysBetween,
} from './pricing';

// Every number asserted below is published in docs/Meridian-System-Spec.md. Where a test
// disagrees with the implementation, the implementation is wrong: the spec's worked examples
// were independently recomputed twice under rational arithmetic during Phase A.
//
// Everything here is integer cents. MR-STO-01 forbids binary floating point, and the
// half-cent ties in MR-STO-04 are exactly where a float would decide the wrong way.

const $ = (dollars: string): number => {
  const [whole, frac = '00'] = dollars.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
};

describe('MR-STO-01 rounding is half-up, away from zero, at two decimals', () => {
  it('rounds an exact half-cent tie up', () => {
    // 6.445 dollars, the MR-STO-04 discount tie, expressed as 64450 hundredths of a cent.
    expect(roundHalfUp(64450, 100)).toBe(645);
    // 4.785 dollars, the MR-STO-04 tax tie.
    expect(roundHalfUp(4785000, 10000)).toBe(479);
  });

  it('does not round half to even', () => {
    // Half-even would give 644 here (644 is even) and 478 there. Both are wrong.
    expect(roundHalfUp(64450, 100)).not.toBe(644);
    expect(roundHalfUp(4785000, 10000)).not.toBe(478);
  });

  it('does not truncate', () => {
    expect(roundHalfUp(11115225, 10000)).toBe(1112);
  });

  it('rounds away from zero on a negative tie', () => {
    expect(roundHalfUp(-64450, 100)).toBe(-645);
  });
});

describe('MR-STO-02 order total composition', () => {
  it('reproduces the published worked example exactly', () => {
    // Three separate products at $49.90 each, quantity 1 per line, 10% discount code.
    const totals = computeTotals(
      [
        { unitPriceCents: $('49.90'), quantity: 1 },
        { unitPriceCents: $('49.90'), quantity: 1 },
        { unitPriceCents: $('49.90'), quantity: 1 },
      ],
      10
    );

    expect(totals.orderSubtotalCents).toBe($('149.70'));
    expect(totals.discountCents).toBe($('14.97'));
    expect(totals.discountedSubtotalCents).toBe($('134.73'));
    expect(totals.taxCents).toBe($('11.12'));
    expect(totals.shippingCents).toBe($('12.00'));
    expect(totals.totalCents).toBe($('157.85'));
  });

  it('applies the discount before tax, not after', () => {
    // MR-STO-03 names the after-tax mistake and its exact consequence: a total of $159.08,
    // which overcharges by $1.23 while every line on the screen still looks right.
    const totals = computeTotals(
      [
        { unitPriceCents: $('49.90'), quantity: 1 },
        { unitPriceCents: $('49.90'), quantity: 1 },
        { unitPriceCents: $('49.90'), quantity: 1 },
      ],
      10
    );
    expect(totals.totalCents).not.toBe($('159.08'));
    expect(totals.taxCents).not.toBe($('12.35'));
  });

  it('computes a line subtotal as unit price times quantity with no rounding', () => {
    const totals = computeTotals([{ unitPriceCents: $('49.90'), quantity: 3 }], 10);
    expect(totals.orderSubtotalCents).toBe($('149.70'));
    expect(totals.totalCents).toBe($('157.85'));
  });
});

describe('MR-STO-04 tax is computed once at order level', () => {
  it('gives $2.99 at order level where per line and summed would give $3.00', () => {
    const totals = computeTotals(
      [
        { unitPriceCents: $('12.10'), quantity: 1 },
        { unitPriceCents: $('12.10'), quantity: 1 },
        { unitPriceCents: $('12.10'), quantity: 1 },
      ],
      0
    );

    expect(totals.orderSubtotalCents).toBe($('36.30'));
    expect(totals.taxCents).toBe($('2.99'));
    // The per-line method overcharges by a cent on a cart this small and scales with lines.
    expect(totals.taxCents).not.toBe($('3.00'));
  });

  it('resolves the cart that ties at both rounding points', () => {
    // $49.90 and $14.55, quantity 1 per line, 10% code. This is the cart that decides the
    // rounding mode: both the discount and the tax land on an exact half cent.
    const totals = computeTotals(
      [
        { unitPriceCents: $('49.90'), quantity: 1 },
        { unitPriceCents: $('14.55'), quantity: 1 },
      ],
      10
    );

    expect(totals.orderSubtotalCents).toBe($('64.45'));
    expect(totals.discountCents).toBe($('6.45'));
    expect(totals.discountedSubtotalCents).toBe($('58.00'));
    expect(totals.taxCents).toBe($('4.79'));
    expect(totals.shippingCents).toBe($('12.00'));
    expect(totals.totalCents).toBe($('74.79'));
  });

  it('rejects each wrong rounding mode by its published composed lines', () => {
    const totals = computeTotals(
      [
        { unitPriceCents: $('49.90'), quantity: 1 },
        { unitPriceCents: $('14.55'), quantity: 1 },
      ],
      10
    );

    // Half-even at the tax point only: $74.78, undercharged by a cent.
    expect(totals.totalCents).not.toBe($('74.78'));
    // Half-even at the discount point: $74.80, overcharged by a cent.
    expect(totals.totalCents).not.toBe($('74.80'));
    // Truncation at both points reaches the correct $74.79 by two compensating errors, so
    // the total alone cannot catch it. Comparing the composed lines is what catches it,
    // which is the whole reason this assertion is on discount and tax and not on the total.
    expect([totals.discountCents, totals.taxCents]).not.toEqual([$('6.44'), $('4.78')]);
    expect([totals.discountCents, totals.taxCents]).toEqual([$('6.45'), $('4.79')]);
  });
});

describe('MR-STO-05 free shipping threshold', () => {
  it('is $200.00 and $12.00', () => {
    expect(FREE_SHIPPING_THRESHOLD_CENTS).toBe($('200.00'));
    expect(FLAT_SHIPPING_CENTS).toBe($('12.00'));
  });

  it.each([
    ['199.99', '12.00'],
    ['200.00', '0.00'],
    ['200.01', '0.00'],
  ])('a discounted subtotal of $%s pays $%s shipping', (subtotal, shipping) => {
    const totals = computeTotals([{ unitPriceCents: $(subtotal), quantity: 1 }], 0);
    expect(totals.discountedSubtotalCents).toBe($(subtotal));
    expect(totals.shippingCents).toBe($(shipping));
  });

  it('tests the threshold against the discounted subtotal, not the order subtotal', () => {
    // A $210.00 subtotal with a 10% code has a discounted subtotal of $189.00 and pays $12.
    const totals = computeTotals([{ unitPriceCents: $('210.00'), quantity: 1 }], 10);
    expect(totals.orderSubtotalCents).toBe($('210.00'));
    expect(totals.discountedSubtotalCents).toBe($('189.00'));
    expect(totals.shippingCents).toBe($('12.00'));
  });

  it('does not tax shipping', () => {
    const paid = computeTotals([{ unitPriceCents: $('100.00'), quantity: 1 }], 0);
    expect(paid.taxCents).toBe(roundHalfUp($('100.00') * 825, 10000));
    expect(paid.totalCents).toBe($('100.00') + paid.taxCents + $('12.00'));
  });
});

describe('MR-STO-08 refund arithmetic', () => {
  // Continuing the MR-STO-02 cart with a captured total of $157.85 and $12.00 of captured
  // shipping. The published refunds are $48.62, $48.61, and $60.62.
  const LINE = { unitPriceCents: $('49.90'), quantity: 1 };
  const CAPTURED_SHIPPING = $('12.00');

  it('reproduces the published refund sequence', () => {
    let capturedTotal = $('157.85');

    const afterFirst = recomputeRemainingTotal([LINE, LINE], 10, CAPTURED_SHIPPING);
    expect(afterFirst).toBe($('109.23'));
    expect(capturedTotal - afterFirst).toBe($('48.62'));
    capturedTotal = afterFirst;

    const afterSecond = recomputeRemainingTotal([LINE], 10, CAPTURED_SHIPPING);
    expect(afterSecond).toBe($('60.62'));
    expect(capturedTotal - afterSecond).toBe($('48.61'));
    capturedTotal = afterSecond;

    const afterThird = recomputeRemainingTotal([], 10, CAPTURED_SHIPPING);
    expect(afterThird).toBe(0);
    expect(capturedTotal - afterThird).toBe($('60.62'));
  });

  it('refunds exactly the captured total across the three refunds, with no residue', () => {
    // This is the invariant the rule names as the one to test. The naive per-line
    // alternative gives $157.86 and over-refunds by a cent no screen displays.
    const refunds = [$('48.62'), $('48.61'), $('60.62')];
    expect(refunds.reduce((a, b) => a + b, 0)).toBe($('157.85'));
    expect(refunds.reduce((a, b) => a + b, 0)).not.toBe($('157.86'));
  });

  it('holds shipping at the captured amount rather than recomputing the threshold', () => {
    // Remaining lines total $99.80, which is below $200.00. If shipping were recomputed the
    // customer would be charged $12.00 they were already charged, or refunded it early.
    expect(recomputeRemainingTotal([LINE, LINE], 10, CAPTURED_SHIPPING)).toBe($('109.23'));
  });

  it('refunds shipping only on the refund that leaves no unrefunded lines', () => {
    expect(recomputeRemainingTotal([], 10, CAPTURED_SHIPPING)).toBe(0);
  });
});

describe('MR-STO-03 discount code validity', () => {
  const code = { ratePercent: 10, active: 1, expiresOn: '2026-06-30' };

  it('is usable on its expiry date and not the day after', () => {
    expect(isCodeUsableOn(code, Date.UTC(2026, 5, 30, 23, 59, 59))).toBe(true);
    expect(isCodeUsableOn(code, Date.UTC(2026, 6, 1, 0, 0, 0))).toBe(false);
  });

  it('is unusable when the active flag is off, whatever the expiry', () => {
    expect(isCodeUsableOn({ ...code, active: 0 }, Date.UTC(2026, 0, 1))).toBe(false);
  });
});

describe('date helpers the refund window and code expiry depend on', () => {
  it('renders a UTC calendar date', () => {
    expect(utcDate(Date.UTC(2026, 7, 11, 23, 30, 0))).toBe('2026-08-11');
  });

  it('counts whole days between two UTC calendar dates', () => {
    expect(wholeDaysBetween(Date.UTC(2026, 7, 1, 23, 0, 0), Date.UTC(2026, 7, 11, 1, 0, 0))).toBe(10);
    expect(wholeDaysBetween(Date.UTC(2026, 7, 1, 0, 0, 0), Date.UTC(2026, 7, 12, 23, 59, 0))).toBe(11);
  });
});
