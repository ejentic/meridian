import { createHash } from 'node:crypto';
import { getDb } from './index';

// Deterministic fixture data. Every id, price, date, and salt below is fixed, and nothing
// reads the wall clock, because boundary tests in Tasks 3 to 5 assert against these values
// and a fixture that drifts with the calendar would make those tests fail on a Tuesday.
//
// The products and discount codes are chosen so the worked examples published in
// docs/Meridian-System-Spec.md can be reproduced exactly: three lines at $49.90 for
// MR-STO-02, $49.90 with $14.55 for MR-STO-04's half-cent tie, three lines at $12.10 for
// MR-STO-04's per-line against order-level comparison, and $210.00 for MR-STO-05's case
// where a discount moves an order back into paid shipping.

/**
 * The fixture's credential scheme, stated plainly: a salted SHA-256 digest, which is not a
 * password-storage scheme anyone should copy. It is deterministic and fast so the seed can
 * run per test file. The specification declares no credential rule at all, so there is
 * nothing here to be faithful to; see the ambiguity log.
 */
export function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

export const SEED_PASSWORD = 'meridian';

export const USERS = [
  { id: 1, email: 'admin01@meridian-corp.test', fullName: 'Avery Cruz', role: 'Administrator', managerId: null },
  { id: 2, email: 'manager01@meridian-corp.test', fullName: 'Blair Santos', role: 'Manager', managerId: 1 },
  { id: 3, email: 'associate01@meridian-corp.test', fullName: 'Casey Lim', role: 'Associate', managerId: 2 },
  { id: 4, email: 'associate02@meridian-corp.test', fullName: 'Devon Reyes', role: 'Associate', managerId: 2 },
  // Reports to the Administrator, not to manager01. This is the user that makes MR-REV-04
  // rule 7 and MR-STO-08's Manager scope testable: manager01 may not evaluate or refund for
  // someone who is not their direct report.
  { id: 5, email: 'associate03@meridian-corp.test', fullName: 'Emery Tan', role: 'Associate', managerId: 1 },
] as const;

const PRODUCTS = [
  { id: 1, sku: 'STO-0001', name: 'Harmony Studio Monitor', unitPriceCents: 4990, onHandQty: 100 },
  { id: 2, sku: 'STO-0002', name: 'Harmony Field Recorder', unitPriceCents: 4990, onHandQty: 100 },
  { id: 3, sku: 'STO-0003', name: 'Harmony Cable Kit', unitPriceCents: 4990, onHandQty: 100 },
  { id: 4, sku: 'STO-0004', name: 'Harmony Pop Filter', unitPriceCents: 1455, onHandQty: 100 },
  { id: 5, sku: 'STO-0005', name: 'Harmony Console', unitPriceCents: 21000, onHandQty: 100 },
  { id: 6, sku: 'STO-0006', name: 'Harmony Cable, Short', unitPriceCents: 1210, onHandQty: 100 },
  { id: 7, sku: 'STO-0007', name: 'Harmony Cable, Long', unitPriceCents: 1210, onHandQty: 100 },
  { id: 8, sku: 'STO-0008', name: 'Harmony Cable, Coiled', unitPriceCents: 1210, onHandQty: 100 },
  // One unit on hand. MR-STO-07's "two checkouts compete for the last unit" case.
  { id: 9, sku: 'STO-0009', name: 'Harmony Case, Last Unit', unitPriceCents: 9900, onHandQty: 1 },
] as const;

const DISCOUNT_CODES = [
  { id: 1, code: 'SAVE10', ratePercent: 10, active: 1, expiresOn: '2026-12-31' },
  { id: 2, code: 'SAVE01', ratePercent: 1, active: 1, expiresOn: '2026-12-31' },
  { id: 3, code: 'SAVE50', ratePercent: 50, active: 1, expiresOn: '2026-12-31' },
  { id: 4, code: 'LAPSED', ratePercent: 10, active: 1, expiresOn: '2026-01-01' },
  { id: 5, code: 'SWITCHEDOFF', ratePercent: 10, active: 0, expiresOn: '2026-12-31' },
] as const;

const REVIEW_CYCLES = [
  { id: 1, name: '2026 Annual Review', startDate: '2026-01-01', endDate: '2026-12-31', status: 'Open' },
  { id: 2, name: '2025 Annual Review', startDate: '2025-01-01', endDate: '2025-12-31', status: 'Closed' },
  { id: 3, name: '2027 Annual Review', startDate: '2027-01-01', endDate: '2027-12-31', status: 'Planned' },
] as const;

/** Expected row counts, asserted by the seed test and by nothing else. */
export const SEED_COUNTS = {
  users: USERS.length,
  products: PRODUCTS.length,
  discount_codes: DISCOUNT_CODES.length,
  review_cycles: REVIEW_CYCLES.length,
  orders: 0,
  order_lines: 0,
  evaluations: 0,
  competency_ratings: 0,
  sessions: 0,
} as const;

export function seed(): void {
  const db = getDb();

  db.transaction(() => {
    const insertUser = db.prepare(
      `INSERT INTO users (id, email, full_name, role, manager_id, active, password_hash, password_salt)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    );
    // Users are inserted before their manager references are set, so that the order of this
    // array cannot break the self-referencing foreign key.
    for (const user of USERS) {
      const salt = `salt-${user.id}`;
      insertUser.run(
        user.id,
        user.email,
        user.fullName,
        user.role,
        null,
        hashPassword(SEED_PASSWORD, salt),
        salt
      );
    }
    const setManager = db.prepare('UPDATE users SET manager_id = ? WHERE id = ?');
    for (const user of USERS) {
      if (user.managerId !== null) setManager.run(user.managerId, user.id);
    }

    const insertProduct = db.prepare(
      'INSERT INTO products (id, sku, name, unit_price_cents, on_hand_qty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const p of PRODUCTS) {
      insertProduct.run(p.id, p.sku, p.name, p.unitPriceCents, p.onHandQty);
    }

    const insertCode = db.prepare(
      'INSERT INTO discount_codes (id, code, rate_percent, active, expires_on) VALUES (?, ?, ?, ?, ?)'
    );
    for (const c of DISCOUNT_CODES) {
      insertCode.run(c.id, c.code, c.ratePercent, c.active, c.expiresOn);
    }

    const insertCycle = db.prepare(
      'INSERT INTO review_cycles (id, name, start_date, end_date, status) VALUES (?, ?, ?, ?, ?)'
    );
    for (const cycle of REVIEW_CYCLES) {
      insertCycle.run(cycle.id, cycle.name, cycle.startDate, cycle.endDate, cycle.status);
    }
  })();
}
