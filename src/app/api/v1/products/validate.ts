import { unprocessable } from '../../../../lib/errors';

/**
 * MR-STO-01 holds money in integer cents, and MR-STO-07 says on-hand quantity is an integer
 * that may never go below 0. Both checks are the same check, so it is written once: a
 * fractional price and a negative stock level are rejected by the same function and cannot
 * drift apart between create and update.
 *
 * The schema carries the same constraint, which would refuse the write anyway. That refusal
 * would arrive as a database error rather than the 422 the module's status-code convention
 * states, so this exists to give the caller the code the rule promises.
 */
export function assertNonNegativeInteger(field: string, value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw unprocessable(`${field} must be an integer of 0 or more`);
  }
}
