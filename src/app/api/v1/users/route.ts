import { randomUUID } from 'node:crypto';
import { getDb } from '../../../../db/index';
import { hashPassword } from '../../../../db/seed';
import { requireRole, requireSession } from '../../../../lib/authz';
import { conflict, respond, unprocessable } from '../../../../lib/errors';
import { ROLES, assertManagerExists } from './validate';

/**
 * MR-PLT-01 gives user administration to the Administrator alone. This is the endpoint the
 * Platform tests use for the second half of MR-PLT-02's paired test: something a role may
 * not read, refused by the server rather than by an absent button.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    const principal = requireSession(request);
    requireRole(principal, 'Administrator');

    const users = getDb()
      .prepare('SELECT id, email, full_name, role, manager_id, active FROM users ORDER BY id')
      .all();
    return Response.json({ users });
  });
}

interface NewUser {
  email?: unknown;
  fullName?: unknown;
  password?: unknown;
  role?: unknown;
  managerId?: unknown;
}

/**
 * MR-PLT-01: creating users is Administrator only.
 *
 * A created user is active. There is no way to create an inactive one and no way to make an
 * inactive one active again, which is the same freeze that says deactivation is one way.
 */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    requireRole(principal, 'Administrator');

    const body = (await request.json().catch(() => ({}))) as NewUser;

    if (typeof body.email !== 'string' || body.email.length === 0) {
      throw unprocessable('email is required');
    }
    if (typeof body.fullName !== 'string' || body.fullName.length === 0) {
      throw unprocessable('fullName is required');
    }
    if (typeof body.password !== 'string' || body.password.length === 0) {
      // MR-PLT-01 states no complexity rule, so this checks presence and nothing else.
      throw unprocessable('password is required');
    }
    if (!ROLES.includes(body.role as (typeof ROLES)[number])) {
      throw unprocessable(`role must be one of: ${ROLES.join(', ')}`);
    }

    const managerId = body.managerId ?? null;
    if (managerId !== null && !Number.isInteger(managerId)) {
      throw unprocessable('managerId must be an integer or null');
    }
    if (managerId !== null) assertManagerExists(managerId as number);

    const duplicate = getDb().prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (duplicate !== undefined) throw conflict('A user with that email already exists');

    const salt = randomUUID();
    const result = getDb()
      .prepare(
        `INSERT INTO users (email, full_name, role, manager_id, active, password_hash, password_salt)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        body.email,
        body.fullName,
        body.role as string,
        managerId,
        hashPassword(body.password, salt),
        salt
      );

    return Response.json({ id: Number(result.lastInsertRowid) }, { status: 201 });
  });
}
