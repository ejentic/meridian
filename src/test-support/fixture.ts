// Shared test scaffolding. Every test file resets and reseeds, so no test can observe
// another's writes, and each test file gets its own in-memory database.
//
// Set before anything opens a connection. getDb() is lazy and nothing connects at import
// time, but this runs at module scope so the ordering does not depend on that staying true.
process.env.MERIDIAN_DB ??= ':memory:';

import { resetDb } from '../db/index';
import { SEED_PASSWORD, seed } from '../db/seed';
import { SESSION_COOKIE } from '../lib/authz';

export const BASE = 'http://meridian.test';

export function resetAndSeed(): void {
  resetDb();
  seed();
}

/** Builds a Request with an optional session cookie, the way a browser would send one. */
export function req(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {}
): Request {
  const headers: Record<string, string> = {};
  if (options.token) headers.cookie = `${SESSION_COOKIE}=${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${BASE}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** Reads the session token out of a Set-Cookie header. */
export function tokenFromResponse(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('response carried no Set-Cookie header');
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error(`no ${SESSION_COOKIE} in Set-Cookie: ${setCookie}`);
  return match[1];
}

export { SEED_PASSWORD };
