'use client';

/**
 * Formats integer cents.
 *
 * MR-STO-01 holds money in integer cents, and this does no arithmetic on them beyond
 * splitting the integer for display: every amount shown was computed by the server. A
 * formatter that added, discounted, or taxed anything would be a second implementation of
 * MR-STO-02 that no test covers.
 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole.toLocaleString('en-US')}.${fraction}`;
}

export function Money({ cents }: { cents: number }) {
  return <span className="money">{formatCents(cents)}</span>;
}
