import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE, SEED_PASSWORD, req, resetAndSeed, tokenFromResponse } from '../../../../test-support/fixture';
import { closeDb, getDb } from '../../../../db/index';
import { resetClock, setClock } from '../../../../lib/clock';
import { ABSOLUTE_LIMIT_MS, IDLE_LIMIT_MS } from '../../../../lib/session';
import { POST as signIn } from './signin/route';
import { POST as signOut } from './signout/route';
import { GET as me } from '../me/route';
import { GET as listUsers, POST as createUser } from '../users/route';
import { POST as deactivate } from '../users/[id]/deactivate/route';
import { PATCH as updateUser } from '../users/[id]/route';
import { DELETE as endSessions } from '../users/[id]/sessions/route';
import { POST as changePassword } from '../me/password/route';
import { GET as myReports } from '../me/reports/route';

// MR-PLT-02's paired test, at the API layer. Every refusal below is a call to the endpoint
// with that role's real session, not an assertion that a control is missing from a screen.
// The interface is not involved at all, which is the point: "it looks correct in the
// interface but the API allows it" has to be a failing test, not a design conversation.

const SIGN_IN_AT = Date.UTC(2026, 7, 11, 9, 0, 0);

const ROLES = [
  { email: 'admin01@meridian-corp.test', userId: 1, role: 'Administrator' },
  { email: 'manager01@meridian-corp.test', userId: 2, role: 'Manager' },
  { email: 'associate01@meridian-corp.test', userId: 3, role: 'Associate' },
] as const;

beforeEach(() => {
  resetAndSeed();
  setClock(SIGN_IN_AT);
});

afterEach(() => {
  resetClock();
});

afterAll(() => {
  closeDb();
});

async function signInAs(email: string): Promise<string> {
  const response = await signIn(
    req('POST', '/api/v1/auth/signin', { body: { email, password: SEED_PASSWORD } })
  );
  expect(response.status).toBe(200);
  return tokenFromResponse(response);
}

describe('sign-in', () => {
  for (const account of ROLES) {
    it(`signs in ${account.role} and issues a session that reads its own record`, async () => {
      const token = await signInAs(account.email);

      const readable = await me(req('GET', '/api/v1/me', { token }));
      expect(readable.status).toBe(200);
      expect(await readable.json()).toMatchObject({ userId: account.userId, role: account.role });
    });
  }

  it('refuses a wrong password with 401 and issues no session', async () => {
    const response = await signIn(
      req('POST', '/api/v1/auth/signin', {
        body: { email: 'associate01@meridian-corp.test', password: 'not-the-password' },
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('gives the same refusal for an unknown address as for a wrong password', async () => {
    const unknown = await signIn(
      req('POST', '/api/v1/auth/signin', {
        body: { email: 'nobody@meridian-corp.test', password: SEED_PASSWORD },
      })
    );
    const wrongPassword = await signIn(
      req('POST', '/api/v1/auth/signin', {
        body: { email: 'associate01@meridian-corp.test', password: 'wrong' },
      })
    );
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrongPassword.json());
  });
});

describe('MR-PLT-02 role enforcement is server side', () => {
  it('lets an Administrator list users', async () => {
    const token = await signInAs('admin01@meridian-corp.test');
    const response = await listUsers(req('GET', '/api/v1/users', { token }));
    expect(response.status).toBe(200);
    expect((await response.json()).users).toHaveLength(5);
  });

  for (const account of ROLES.filter((r) => r.role !== 'Administrator')) {
    it(`refuses ${account.role} the user list with 403 and no record data`, async () => {
      const token = await signInAs(account.email);
      const response = await listUsers(req('GET', '/api/v1/users', { token }));

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toEqual({ error: 'forbidden', message: expect.any(String) });
      expect(body).not.toHaveProperty('users');
    });
  }

  it('separates the two refusals: no session is 401, wrong role is 403', async () => {
    const noSession = await listUsers(new Request(`${BASE}/api/v1/users`));
    expect(noSession.status).toBe(401);

    const associate = await signInAs('associate01@meridian-corp.test');
    const wrongRole = await listUsers(req('GET', '/api/v1/users', { token: associate }));
    expect(wrongRole.status).toBe(403);
  });

  it('refuses an unknown token with 401', async () => {
    const response = await me(req('GET', '/api/v1/me', { token: 'not-a-real-token' }));
    expect(response.status).toBe(401);
  });

  it('refuses a role-restricted write, not only a read', async () => {
    const associate = await signInAs('associate01@meridian-corp.test');
    const response = await deactivate(
      req('POST', '/api/v1/users/4/deactivate', { token: associate }),
      { params: Promise.resolve({ id: '4' }) }
    );

    expect(response.status).toBe(403);
    // MR-PLT-02: a refused request changes nothing.
    expect(getDb().prepare('SELECT active FROM users WHERE id = 4').get()).toEqual({ active: 1 });
  });
});

describe('MR-PLT-03 expiry at the API layer', () => {
  it('returns 401 once the idle limit is reached', async () => {
    const token = await signInAs('associate01@meridian-corp.test');

    setClock(SIGN_IN_AT + IDLE_LIMIT_MS - 1000);
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(200);

    // That request moved the idle deadline, so measure the limit from it.
    setClock(SIGN_IN_AT + IDLE_LIMIT_MS - 1000 + IDLE_LIMIT_MS);
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(401);
  });

  it('returns 401 at exactly the absolute limit', async () => {
    const token = await signInAs('associate01@meridian-corp.test');

    for (let e = 29 * 60 * 1000; e < ABSOLUTE_LIMIT_MS; e += 29 * 60 * 1000) {
      setClock(SIGN_IN_AT + e);
      expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(200);
    }

    setClock(SIGN_IN_AT + ABSOLUTE_LIMIT_MS);
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(401);
  });
});

describe('MR-PLT-04 sign-out', () => {
  it('invalidates a token that another tab is still holding', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    // Two tabs, one session, both holding the same token.
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(200);

    const out = await signOut(req('POST', '/api/v1/auth/signout', { token }));
    expect(out.status).toBe(204);

    // The second tab's next request. The cookie is still in its hands; the record is gone.
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(401);
  });

  it('replaces the first session when a second user signs in carrying it', async () => {
    const first = await signInAs('associate01@meridian-corp.test');

    const response = await signIn(
      req('POST', '/api/v1/auth/signin', {
        token: first,
        body: { email: 'manager01@meridian-corp.test', password: SEED_PASSWORD },
      })
    );
    const second = tokenFromResponse(response);

    expect((await me(req('GET', '/api/v1/me', { token: second }))).status).toBe(200);
    // The first tab's next request returns 401 rather than acting as the wrong user.
    expect((await me(req('GET', '/api/v1/me', { token: first }))).status).toBe(401);
  });
});

describe('MR-PLT-05 role change and deactivation take effect on the next request', () => {
  it('refuses an Administrator-only endpoint immediately after a demotion', async () => {
    const token = await signInAs('admin01@meridian-corp.test');
    expect((await listUsers(req('GET', '/api/v1/users', { token }))).status).toBe(200);

    getDb().prepare("UPDATE users SET role = 'Associate' WHERE id = 1").run();

    // No new sign-in, no reload. The very next request is refused.
    expect((await listUsers(req('GET', '/api/v1/users', { token }))).status).toBe(403);
  });

  it('returns 401 on the next request after the caller is deactivated', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const associate = await signInAs('associate01@meridian-corp.test');
    expect((await me(req('GET', '/api/v1/me', { token: associate }))).status).toBe(200);

    const response = await deactivate(
      req('POST', '/api/v1/users/3/deactivate', { token: admin }),
      { params: Promise.resolve({ id: '3' }) }
    );
    expect(response.status).toBe(204);

    expect((await me(req('GET', '/api/v1/me', { token: associate }))).status).toBe(401);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = 3').get()).toEqual({
      n: 0,
    });
  });

  it('refuses a deactivated user at sign-in as well', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    await deactivate(req('POST', '/api/v1/users/3/deactivate', { token: admin }), {
      params: Promise.resolve({ id: '3' }),
    });

    const response = await signIn(
      req('POST', '/api/v1/auth/signin', {
        body: { email: 'associate01@meridian-corp.test', password: SEED_PASSWORD },
      })
    );
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------
// The rest of MR-PLT-01's Platform column. C.0 built the user list and deactivation; these
// are the capabilities the same rule grants that an interface has to be able to reach.

const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

const NON_ADMIN = ROLES.filter((r) => r.role !== 'Administrator');

function userRow(id: number) {
  return getDb()
    .prepare('SELECT id, email, full_name, role, manager_id, active FROM users WHERE id = ?')
    .get(id) as
    | { id: number; email: string; full_name: string; role: string; manager_id: number | null; active: number }
    | undefined;
}

function passwordHashOf(id: number): string {
  return (getDb().prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(id) as { h: string }).h;
}

describe('POST /users, Administrator only per MR-PLT-01', () => {
  const NEW_USER = {
    email: 'associate04@meridian-corp.test',
    fullName: 'Frankie Vo',
    password: 'starter',
    role: 'Associate',
    managerId: 2,
  };

  it('lets an Administrator create a user who can then sign in', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await createUser(req('POST', '/api/v1/users', { token: admin, body: NEW_USER }));

    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(userRow(id)).toMatchObject({
      email: NEW_USER.email,
      full_name: NEW_USER.fullName,
      role: 'Associate',
      manager_id: 2,
      active: 1,
    });

    const signedIn = await signIn(
      req('POST', '/api/v1/auth/signin', { body: { email: NEW_USER.email, password: NEW_USER.password } })
    );
    expect(signedIn.status).toBe(200);
  });

  for (const account of NON_ADMIN) {
    it(`refuses ${account.role} with 403 and creates nobody`, async () => {
      const token = await signInAs(account.email);
      const response = await createUser(req('POST', '/api/v1/users', { token, body: NEW_USER }));

      expect(response.status).toBe(403);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 5 });
    });
  }

  it('refuses a duplicate email with 409', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await createUser(
      req('POST', '/api/v1/users', {
        token: admin,
        body: { ...NEW_USER, email: 'associate01@meridian-corp.test' },
      })
    );

    expect(response.status).toBe(409);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 5 });
  });

  it('refuses a role outside the three with 422', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await createUser(
      req('POST', '/api/v1/users', { token: admin, body: { ...NEW_USER, role: 'Superuser' } })
    );

    expect(response.status).toBe(422);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 5 });
  });

  it('refuses a managerId that names nobody with 422', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await createUser(
      req('POST', '/api/v1/users', { token: admin, body: { ...NEW_USER, managerId: 999 } })
    );
    expect(response.status).toBe(422);
  });
});

describe('PATCH /users/[id], role and managerId maintenance', () => {
  it('lets an Administrator change a role', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateUser(
      req('PATCH', '/api/v1/users/3', { token: admin, body: { role: 'Manager' } }),
      params(3)
    );

    expect(response.status).toBe(200);
    expect(userRow(3)).toMatchObject({ role: 'Manager' });
  });

  it('lets an Administrator change a managerId', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateUser(
      req('PATCH', '/api/v1/users/3', { token: admin, body: { managerId: 1 } }),
      params(3)
    );

    expect(response.status).toBe(200);
    expect(userRow(3)).toMatchObject({ manager_id: 1 });
  });

  it('accepts a null managerId, which MR-PLT-01 says means no manager', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateUser(
      req('PATCH', '/api/v1/users/3', { token: admin, body: { managerId: null } }),
      params(3)
    );

    expect(response.status).toBe(200);
    expect(userRow(3)).toMatchObject({ manager_id: null });
  });

  for (const account of NON_ADMIN) {
    it(`refuses ${account.role} with 403 and changes nothing`, async () => {
      const token = await signInAs(account.email);
      const response = await updateUser(
        req('PATCH', '/api/v1/users/3', { token, body: { role: 'Administrator' } }),
        params(3)
      );

      expect(response.status).toBe(403);
      expect(userRow(3)).toMatchObject({ role: 'Associate' });
    });
  }

  it('refuses a role outside the three with 422', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateUser(
      req('PATCH', '/api/v1/users/3', { token: admin, body: { role: 'Superuser' } }),
      params(3)
    );

    expect(response.status).toBe(422);
    expect(userRow(3)).toMatchObject({ role: 'Associate' });
  });

  it('refuses a managerId that would make a user their own manager with 422', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const response = await updateUser(
      req('PATCH', '/api/v1/users/3', { token: admin, body: { managerId: 3 } }),
      params(3)
    );

    expect(response.status).toBe(422);
    expect(userRow(3)).toMatchObject({ manager_id: 2 });
  });

  it('cannot be used to reactivate a deactivated user', async () => {
    // MR-PLT-01 freezes the capability lists as complete, and no role holds a reactivate
    // capability, so deactivation is one way. This endpoint accepts role and managerId and
    // nothing else, which is what makes that structural rather than a matter of discipline.
    const admin = await signInAs('admin01@meridian-corp.test');
    await deactivate(req('POST', '/api/v1/users/3/deactivate', { token: admin }), params(3));
    expect(userRow(3)).toMatchObject({ active: 0 });

    const response = await updateUser(
      req('PATCH', '/api/v1/users/3', { token: admin, body: { active: 1 } }),
      params(3)
    );

    expect(response.status).toBe(422);
    expect(userRow(3)).toMatchObject({ active: 0 });
  });
});

describe('DELETE /users/[id]/sessions, ending another user session', () => {
  it('lets an Administrator end a user session, refused on that user next request', async () => {
    const admin = await signInAs('admin01@meridian-corp.test');
    const associate = await signInAs('associate01@meridian-corp.test');
    expect((await me(req('GET', '/api/v1/me', { token: associate }))).status).toBe(200);

    const response = await endSessions(
      req('DELETE', '/api/v1/users/3/sessions', { token: admin }),
      params(3)
    );

    expect(response.status).toBe(204);
    expect((await me(req('GET', '/api/v1/me', { token: associate }))).status).toBe(401);
    // The user is still active, so they can sign in again. This is not deactivation.
    expect(userRow(3)).toMatchObject({ active: 1 });
  });

  for (const account of NON_ADMIN) {
    it(`refuses ${account.role} with 403 and leaves the session alive`, async () => {
      const victim = await signInAs('associate02@meridian-corp.test');
      const token = await signInAs(account.email);

      const response = await endSessions(
        req('DELETE', '/api/v1/users/4/sessions', { token }),
        params(4)
      );

      expect(response.status).toBe(403);
      expect((await me(req('GET', '/api/v1/me', { token: victim }))).status).toBe(200);
    });
  }
});

describe('POST /me/password, any authenticated user changing their own', () => {
  it('changes the password and leaves the caller session working', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const before = passwordHashOf(3);

    const response = await changePassword(
      req('POST', '/api/v1/me/password', {
        token,
        body: { currentPassword: SEED_PASSWORD, newPassword: 'a-new-one' },
      })
    );

    expect(response.status).toBe(204);
    expect(passwordHashOf(3)).not.toBe(before);
    // MR-PLT-03 names two session limits and a password change is neither, so the session
    // the change arrived on survives it.
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(200);

    const signedIn = await signIn(
      req('POST', '/api/v1/auth/signin', {
        body: { email: 'associate01@meridian-corp.test', password: 'a-new-one' },
      })
    );
    expect(signedIn.status).toBe(200);
  });

  it('refuses a wrong current password with 401 and leaves the stored hash unchanged', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const before = passwordHashOf(3);

    const response = await changePassword(
      req('POST', '/api/v1/me/password', {
        token,
        body: { currentPassword: 'not-the-password', newPassword: 'a-new-one' },
      })
    );

    expect(response.status).toBe(401);
    expect(passwordHashOf(3)).toBe(before);
    // Still signed in: a failed change is not a reason to end the session.
    expect((await me(req('GET', '/api/v1/me', { token }))).status).toBe(200);
  });

  it('is available to every role, because MR-PLT-01 grants it to all three', async () => {
    for (const account of ROLES) {
      resetAndSeed();
      const token = await signInAs(account.email);
      const response = await changePassword(
        req('POST', '/api/v1/me/password', {
          token,
          body: { currentPassword: SEED_PASSWORD, newPassword: `new-${account.userId}` },
        })
      );
      expect(response.status).toBe(204);
    }
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await changePassword(
      req('POST', '/api/v1/me/password', {
        body: { currentPassword: SEED_PASSWORD, newPassword: 'a-new-one' },
      })
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /me/reports, the 2026-08-11 MR-PLT-01 amendment', () => {
  it('returns a Manager exactly their own direct reports', async () => {
    const token = await signInAs('manager01@meridian-corp.test');
    const response = await myReports(req('GET', '/api/v1/me/reports', { token }));

    expect(response.status).toBe(200);
    const { reports } = await response.json();
    // associate03 reports to the Administrator, so they are not here.
    expect(reports.map((r: { id: number }) => r.id)).toEqual([3, 4]);
  });

  it('returns an Associate an empty list with 200, because having no reports is not an error', async () => {
    const token = await signInAs('associate01@meridian-corp.test');
    const response = await myReports(req('GET', '/api/v1/me/reports', { token }));

    expect(response.status).toBe(200);
    expect((await response.json()).reports).toEqual([]);
  });

  it('carries only id, full name, and role', async () => {
    // The amendment bounds this deliberately: it is a read of who reports to the caller and
    // not user administration, so it must not become a route to the user list.
    const token = await signInAs('manager01@meridian-corp.test');
    const response = await myReports(req('GET', '/api/v1/me/reports', { token }));

    const { reports } = await response.json();
    expect(Object.keys(reports[0]).sort()).toEqual(['fullName', 'id', 'role']);
    expect(reports[0]).toEqual({ id: 3, fullName: 'Casey Lim', role: 'Associate' });
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await myReports(new Request(`${BASE}/api/v1/me/reports`));
    expect(response.status).toBe(401);
  });
});
