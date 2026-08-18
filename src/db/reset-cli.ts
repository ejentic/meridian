/**
 * Drops, recreates, and reseeds the Meridian database. `npm run db:reset`.
 *
 * This is the reset a trainee or a facilitator runs between exercises, against the real
 * database file. It is not the reset the end-to-end suite uses: that one is an endpoint,
 * because the dev server holds the database open in its own process and a reset issued from
 * outside would drop the tables underneath a connection still pointing at them.
 *
 * The row counts are printed rather than assumed. A reset that silently wrote nothing looks
 * exactly like one that worked, and the whole point of resetting is to know what you are
 * starting from.
 */
import { closeDb, getDb, resetDb } from './index';
import { SEED_COUNTS, seed } from './seed';

const TABLES = Object.keys(SEED_COUNTS) as (keyof typeof SEED_COUNTS)[];

function countOf(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

resetDb();
seed();

console.log(`Meridian database reset: ${process.env.MERIDIAN_DB ?? 'meridian.db'}`);
for (const table of TABLES) {
  const actual = countOf(table);
  const expected = SEED_COUNTS[table];
  const agrees = actual === expected ? 'ok' : `EXPECTED ${expected}`;
  console.log(`  ${table.padEnd(20)} ${String(actual).padStart(4)}  ${agrees}`);
}

closeDb();
