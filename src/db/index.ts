import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

// A hand-written data layer rather than an ORM, on purpose. Trainees and facilitators read
// this code as part of the courseware, so the SQL a rule produces should be visible next to
// the rule it came from.

/**
 * This module's own directory.
 *
 * Derived from import.meta.url rather than import.meta.dirname, which Turbopack leaves
 * undefined in the server bundle `next dev` runs. That produced `path.join(undefined, ...)`
 * and a 500 on the first request to touch the database, and C.0 never saw it because every
 * one of its tests calls a route handler as a plain function under Vitest and no test ever
 * started the server. import.meta.url is correct under both.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA_PATH = path.join(HERE, 'schema.sql');

/**
 * Where the database lives. Tests set MERIDIAN_DB to ':memory:' so each test file gets its
 * own database and no test can see another's writes, and the end-to-end run sets it to a
 * file of its own so resetting the fixture does not discard what a facilitator is showing.
 */
function databasePath(): string {
  return process.env.MERIDIAN_DB ?? path.join(HERE, '..', '..', 'meridian.db');
}

let connection: Database.Database | null = null;

export function getDb(): Database.Database {
  if (connection === null) {
    connection = new Database(databasePath());
    // Off by default in SQLite. The schema declares real foreign keys, and a fixture whose
    // referential integrity is decorative would teach the wrong lesson.
    connection.pragma('foreign_keys = ON');
  }
  return connection;
}

export function closeDb(): void {
  if (connection !== null) {
    connection.close();
    connection = null;
  }
}

/** Drops every table and recreates the schema. */
export function resetDb(): void {
  const db = getDb();
  // Same normalisation the canon checker needs: this repository is authored on Windows with
  // core.autocrlf=true, so schema.sql materialises with CRLF on checkout.
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8').replace(/\r\n/g, '\n');

  db.pragma('foreign_keys = OFF');
  const tables = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .all();
  for (const table of tables) {
    db.exec(`DROP TABLE IF EXISTS "${table.name}"`);
  }
  db.exec(schema);
  db.pragma('foreign_keys = ON');
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function inTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
