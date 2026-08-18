'use client';

import type { Principal } from '../shared/types';

/**
 * Storefront role logic, as the interface sees it.
 *
 * THIS DUPLICATES src/lib/order.ts ON PURPOSE. Do not remove it, and do not replace it with
 * a permitted-actions field returned by the API.
 *
 * MR-PLT-02 says hiding a control is presentation and not enforcement, and that a request
 * issued directly against the API must be refused on exactly the same terms as one issued
 * through the interface. That sentence only means something if the two checks are genuinely
 * independent and can therefore disagree. The server deciding what the interface may draw
 * would collapse them into one decision made once, and the whole class of "it looks correct
 * in the interface but the API allows it" defect would stop being expressible.
 *
 * The paired tests in e2e/ are what detect a disagreement between this file and the server's
 * copy. Both halves of every pair have to be written, not just the convenient half.
 */

/**
 * MR-STO-08 as amended 2026-08-11.
 *
 * `directReportIds` comes from GET /me/reports, which returns people and not permissions.
 * The rule is applied here, to that list, rather than asked of the server.
 */
export function mayRefundOrder(
  principal: Principal,
  order: { userId: number },
  directReportIds: readonly number[]
): boolean {
  // Nobody refunds an order they placed themselves, whatever their role.
  if (order.userId === principal.userId) return false;
  if (principal.role === 'Administrator') return true;
  if (principal.role === 'Associate') return false;
  return directReportIds.includes(order.userId);
}

/**
 * MR-STO-06's write lock. Order contents are editable only in Cart.
 *
 * The interface uses this to stop drawing content controls the moment an order leaves Cart;
 * the server refuses the same writes with 409 whether or not it does.
 */
export function isContentEditable(status: string): boolean {
  return status === 'Cart';
}
