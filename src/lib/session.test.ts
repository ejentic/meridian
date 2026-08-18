import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetAndSeed } from '../test-support/fixture';
import { closeDb, getDb } from '../db/index';
import {
  ABSOLUTE_LIMIT_MS,
  IDLE_LIMIT_MS,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  getSession,
} from './session';

// MR-PLT-03. The clock is a parameter, never the wall clock, because the rule's boundaries
// are stated to the second and a test that sleeps for 30 minutes is not a test anyone runs.
//
// The rule's own worked example: sign-in at 09:00:00, a request at 09:29:59 keeps the
// session alive and moves the idle deadline to 09:59:59; with no request until exactly
// 09:30:00 the session is already expired. Both limits expire on being reached, so the
// comparison is elapsed >= limit and not elapsed > limit.

const SIGN_IN = Date.UTC(2026, 7, 11, 9, 0, 0);
const ASSOCIATE = 3;

beforeEach(() => {
  resetAndSeed();
});

afterAll(() => {
  closeDb();
});

describe('MR-PLT-03 idle limit', () => {
  it('is 30 minutes', () => {
    expect(IDLE_LIMIT_MS).toBe(30 * 60 * 1000);
  });

  it('keeps the session alive one second before the limit', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);
    expect(getSession(token, SIGN_IN + IDLE_LIMIT_MS - 1000)?.userId).toBe(ASSOCIATE);
  });

  it('treats elapsed time exactly equal to the limit as already expired', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);
    expect(getSession(token, SIGN_IN + IDLE_LIMIT_MS)).toBeNull();
  });

  it('treats one second past the limit as expired', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);
    expect(getSession(token, SIGN_IN + IDLE_LIMIT_MS + 1000)).toBeNull();
  });

  it('moves the idle deadline forward on every authenticated request', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);
    const at092959 = SIGN_IN + IDLE_LIMIT_MS - 1000;

    expect(getSession(token, at092959)).not.toBeNull();
    // The deadline is now 09:59:59, so a request at 09:45:00 is still inside it even though
    // it is 45 minutes after sign-in.
    expect(getSession(token, SIGN_IN + 45 * 60 * 1000)).not.toBeNull();
    // And 30 minutes after that last request, it is gone again.
    expect(getSession(token, SIGN_IN + 45 * 60 * 1000 + IDLE_LIMIT_MS)).toBeNull();
  });
});

describe('MR-PLT-03 absolute limit', () => {
  it('is 12 hours', () => {
    expect(ABSOLUTE_LIMIT_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('ends the session 12 hours after sign-in however continuously it is used', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);

    // Use it every 29 minutes, which never trips the idle limit.
    for (let elapsed = 29 * 60 * 1000; elapsed < ABSOLUTE_LIMIT_MS; elapsed += 29 * 60 * 1000) {
      expect(getSession(token, SIGN_IN + elapsed), `alive at +${elapsed}ms`).not.toBeNull();
    }

    // A request timestamped exactly 21:00:00 returns 401.
    expect(getSession(token, SIGN_IN + ABSOLUTE_LIMIT_MS)).toBeNull();
  });

  it('is not extended by a request made one second before it is reached', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);

    // Keep the session alive right up to the edge, so that what kills it at the edge can
    // only be the absolute limit. Without this the session is idle-expired hours earlier,
    // and the test would pass for the wrong reason.
    for (let elapsed = 29 * 60 * 1000; elapsed < ABSOLUTE_LIMIT_MS - 1000; elapsed += 29 * 60 * 1000) {
      getSession(token, SIGN_IN + elapsed);
    }

    expect(getSession(token, SIGN_IN + ABSOLUTE_LIMIT_MS - 1000)).not.toBeNull();
    // That request reset the idle clock, so the session has 30 idle minutes in hand. It
    // ends one second later anyway, because the absolute deadline did not move.
    expect(getSession(token, SIGN_IN + ABSOLUTE_LIMIT_MS)).toBeNull();
  });
});

describe('MR-PLT-04 sign-out and MR-PLT-05 deactivation', () => {
  it('makes a deleted session unusable by any holder of the token', () => {
    const token = createSession(ASSOCIATE, SIGN_IN);
    expect(getSession(token, SIGN_IN + 1000)).not.toBeNull();

    deleteSession(token);

    // The second tab still holds the token. It stops working anyway, because expiry is
    // decided against the stored record and the record is gone.
    expect(getSession(token, SIGN_IN + 2000)).toBeNull();
  });

  it('ends every active session for a user when that user is deactivated', () => {
    const first = createSession(ASSOCIATE, SIGN_IN);
    const second = createSession(ASSOCIATE, SIGN_IN + 1000);

    deleteSessionsForUser(ASSOCIATE);

    expect(getSession(first, SIGN_IN + 2000)).toBeNull();
    expect(getSession(second, SIGN_IN + 2000)).toBeNull();
  });

  it('returns null for a token that was never issued', () => {
    expect(getSession('not-a-real-token', SIGN_IN)).toBeNull();
  });

  it('reads the current role on every request rather than a copy taken at sign-in', () => {
    // MR-PLT-05. The seeded Manager signs in, is demoted, and the session reports the new
    // role on its very next use.
    const token = createSession(2, SIGN_IN);
    expect(getSession(token, SIGN_IN + 1000)?.role).toBe('Manager');

    // Demote through the database rather than an endpoint: this test is about the session
    // carrying a reference and not a cached copy.
    getDb().prepare("UPDATE users SET role = 'Associate' WHERE id = 2").run();

    expect(getSession(token, SIGN_IN + 2000)?.role).toBe('Associate');
  });
});
