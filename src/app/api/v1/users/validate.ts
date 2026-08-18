import { getDb } from '../../../../db/index';
import { unprocessable } from '../../../../lib/errors';
import type { Role } from '../../../../shared/types';

/**
 * The three roles MR-PLT-01 declares, as data, so create and update cannot disagree about
 * what a valid role is. A fourth role is rejected by the absence of a row rather than by
 * remembering to extend a condition.
 */
export const ROLES: readonly Role[] = ['Associate', 'Manager', 'Administrator'];

/**
 * MR-PLT-01: `managerId` is a reference to another user, or null.
 *
 * A reference to nobody is rejected rather than stored, because every rule phrased as "the
 * subject's manager" reads this field and a dangling id would make those rules fail in a way
 * that looks like a permission bug instead of bad data.
 */
export function assertManagerExists(managerId: number): void {
  const manager = getDb().prepare('SELECT id FROM users WHERE id = ?').get(managerId);
  if (manager === undefined) throw unprocessable('managerId does not name a user');
}
