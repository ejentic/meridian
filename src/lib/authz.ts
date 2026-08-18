import { getDb } from '../db/index';
import { now } from './clock';
import { forbidden, unauthorized } from './errors';
import { getSession, type Principal, type Role } from './session';

export const SESSION_COOKIE = 'meridian_session';

/**
 * MR-PLT-02 is the rule this whole module exists to satisfy: every request to /api/v1
 * re-checks the caller's session and role on the server before it does any work. Nothing
 * here consults the interface, and nothing in the interface may be trusted to have done a
 * check first. A request issued directly against the API is refused on exactly the same
 * terms as one issued through the interface.
 */

function tokenFromCookieHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
  return null;
}

/**
 * Reads the session token off a request.
 *
 * The cookie header is parsed directly rather than through next/headers so that a route
 * handler is an ordinary function of a Request and can be called from a test without a
 * server. MR-PLT-04 names the browser cookie explicitly, so the transport is the spec's.
 */
export function readToken(request: Request): string | null {
  return tokenFromCookieHeader(request.headers.get('cookie'));
}

/** Throws 401 unless the request carries a live session. */
export function requireSession(request: Request): Principal {
  const token = readToken(request);
  if (token === null) throw unauthorized();
  const principal = getSession(token, now());
  if (principal === null) throw unauthorized('Session is missing, unknown, or expired');
  return principal;
}

/**
 * Throws 403 unless the caller holds one of `roles`.
 *
 * Separate from requireSession because MR-PLT-02 requires the two refusals to stay distinct:
 * a missing or expired session is 401, a live session whose role does not permit the action
 * is 403, and interchanging them is a defect.
 */
export function requireRole(principal: Principal, ...roles: Role[]): void {
  if (!roles.includes(principal.role)) {
    throw forbidden(`Role ${principal.role} may not perform this action`);
  }
}

/**
 * MR-PLT-01 scoping and MR-REV-04 condition C4. A user with no manager has no manager, so
 * this fails closed rather than matching a null against a null.
 */
export function isDirectReport(managerUserId: number, subjectUserId: number): boolean {
  const row = getDb().prepare('SELECT manager_id FROM users WHERE id = ?').get(subjectUserId) as
    | { manager_id: number | null }
    | undefined;
  if (row === undefined || row.manager_id === null) return false;
  return row.manager_id === managerUserId;
}

/** The manager of a given user, or null. Used by MR-REV-03's "the subject's manager". */
export function managerOf(subjectUserId: number): number | null {
  const row = getDb().prepare('SELECT manager_id FROM users WHERE id = ?').get(subjectUserId) as
    | { manager_id: number | null }
    | undefined;
  return row?.manager_id ?? null;
}
