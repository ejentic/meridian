import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, resetDb } from './index';
import { SEED_COUNTS, USERS, seed } from './seed';

// Determinism is what makes the fixture resettable between cohorts. A facilitator resets
// Meridian, a trainee follows a worksheet that says "sign in as associate01 and observe
// this", and the observation has to be the same every time. That is a property worth a test
// rather than an assumption.

beforeAll(() => {
  process.env.MERIDIAN_DB = ':memory:';
});

afterAll(() => {
  closeDb();
});

function countsByTable(): Record<string, number> {
  const db = getDb();
  const counts: Record<string, number> = {};
  for (const table of Object.keys(SEED_COUNTS)) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    counts[table] = row.n;
  }
  return counts;
}

describe('resetDb and seed', () => {
  it('produces the declared row count in every table', () => {
    resetDb();
    seed();
    expect(countsByTable()).toEqual(SEED_COUNTS);
  });

  it('produces identical counts when the pair runs twice', () => {
    resetDb();
    seed();
    const first = countsByTable();

    resetDb();
    seed();
    const second = countsByTable();

    expect(second).toEqual(first);
  });

  it('produces identical rows when the pair runs twice, not merely identical counts', () => {
    const snapshot = () => {
      const db = getDb();
      return {
        users: db.prepare('SELECT * FROM users ORDER BY id').all(),
        products: db.prepare('SELECT * FROM products ORDER BY id').all(),
        discount_codes: db.prepare('SELECT * FROM discount_codes ORDER BY id').all(),
        review_cycles: db.prepare('SELECT * FROM review_cycles ORDER BY id').all(),
      };
    };

    resetDb();
    seed();
    const first = snapshot();

    resetDb();
    seed();
    expect(snapshot()).toEqual(first);
  });

  it('seeds the manager relationships the Reviews rules depend on', () => {
    resetDb();
    seed();
    const db = getDb();
    const rows = db.prepare('SELECT id, role, manager_id FROM users ORDER BY id').all() as {
      id: number;
      role: string;
      manager_id: number | null;
    }[];

    expect(rows).toEqual(USERS.map((u) => ({ id: u.id, role: u.role, manager_id: u.managerId })));
    // MR-REV-04 rule 7 and MR-STO-08's Manager scope are only testable if at least one
    // Associate is not a direct report of the seeded Manager.
    const notReportingToManager01 = rows.filter((r) => r.role === 'Associate' && r.manager_id !== 2);
    expect(notReportingToManager01.length).toBeGreaterThan(0);
  });

  it('enforces the foreign keys the schema declares', () => {
    resetDb();
    seed();
    const db = getDb();
    expect(() =>
      db.prepare('INSERT INTO orders (user_id, status) VALUES (?, ?)').run(9999, 'Cart')
    ).toThrow(/FOREIGN KEY/i);
  });
});
