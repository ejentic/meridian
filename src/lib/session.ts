import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index';
import type { Principal, Role } from '../shared/types';

// Declared in src/shared/types.ts and re-exported here so every existing import keeps
// working. The types live in a leaf module because this one reaches better-sqlite3 through
// getDb, and a client component importing a type from here would drag a native module into
// the browser bundle.
export type { Principal, Role };

// MR-PLT-03. Two independent limits; whichever is reached first ends the session.
export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000;

/**
 * MR-PLT-04: the session is a server-side record, not a stateless token. That is what makes
 * sign-out in one tab invalidate the token another tab is still holding, and it is why
 * there is a table here rather than a signed cookie.
 */
export function createSession(userId: number, now: number): string {
  const token = randomUUID();
  getDb()
    .prepare(
      'INSERT INTO sessions (token, user_id, created_at_ms, last_seen_at_ms) VALUES (?, ?, ?, ?)'
    )
    .run(token, userId, now, now);
  return token;
}

interface SessionRow {
  user_id: number;
  created_at_ms: number;
  last_seen_at_ms: number;
  role: Role;
  manager_id: number | null;
  active: number;
}

/**
 * Validates a token as of `now` and, if it is good, treats the call as an authenticated
 * request: the idle clock resets, per MR-PLT-03.
 *
 * Returns null for every reason MR-PLT-02 calls a 401: unknown token, idle limit reached,
 * absolute limit reached, or a deactivated user. Expiry is decided here, against the stored
 * record, because MR-PLT-03 says a client-side timer does not satisfy the rule.
 *
 * The role comes from the join and not from the session row, per MR-PLT-05: a session
 * carries a user reference, never a cached copy of the role.
 */
export function getSession(token: string, now: number): Principal | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.user_id, s.created_at_ms, s.last_seen_at_ms, u.role, u.manager_id, u.active
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token) as SessionRow | undefined;

  if (row === undefined) return null;

  // Both limits expire on being reached, not on being exceeded, so this is >= and not >.
  const idleExpired = now - row.last_seen_at_ms >= IDLE_LIMIT_MS;
  const absoluteExpired = now - row.created_at_ms >= ABSOLUTE_LIMIT_MS;
  if (idleExpired || absoluteExpired) {
    // Delete rather than leave it lying around, so an expired record can never be revived
    // by a clock that moves backwards.
    deleteSession(token);
    return null;
  }

  // MR-PLT-05: deactivation takes effect on the next request, not the next sign-in.
  if (row.active !== 1) return null;

  db.prepare('UPDATE sessions SET last_seen_at_ms = ? WHERE token = ?').run(now, token);

  // MR-PLT-05: the principal is read from the row on every request, never cached per token,
  // so a role change or deactivation takes effect on the user's next request.
  return { userId: row.user_id, role: row.role, managerId: row.manager_id };
}

/** MR-PLT-04. Sign-out deletes the record, not only the browser cookie. */
export function deleteSession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** MR-PLT-05. Deactivating a user ends their active sessions immediately. */
export function deleteSessionsForUser(userId: number): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
