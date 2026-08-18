import { getDb } from '../../../../../db/index';
import { hashPassword } from '../../../../../db/seed';
import { SESSION_COOKIE, readToken } from '../../../../../lib/authz';
import { now } from '../../../../../lib/clock';
import { ApiError, respond } from '../../../../../lib/errors';
import { createSession, deleteSession } from '../../../../../lib/session';

interface Credentials {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const body = (await request.json().catch(() => ({}))) as Credentials;
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      throw new ApiError(422, 'unprocessable', 'email and password are required');
    }

    const user = getDb()
      .prepare(
        'SELECT id, role, password_hash, password_salt, active FROM users WHERE email = ?'
      )
      .get(body.email) as
      | { id: number; role: string; password_hash: string; password_salt: string; active: number }
      | undefined;

    // One message for every failure, so the response does not say whether the address exists.
    const refuse = new ApiError(401, 'unauthorized', 'Email or password is incorrect');
    if (user === undefined) throw refuse;
    if (user.active !== 1) throw refuse;
    if (hashPassword(body.password, user.password_salt) !== user.password_hash) throw refuse;

    // MR-PLT-04: two tabs signed in as different users are not supported. If this request
    // arrives carrying a session, signing in replaces it, which is the only reading the
    // server can act on since it cannot observe browsers. See the ambiguity log.
    const existing = readToken(request);
    if (existing !== null) deleteSession(existing);

    const token = createSession(user.id, now());

    return Response.json(
      { userId: user.id, role: user.role },
      {
        status: 200,
        headers: { 'set-cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` },
      }
    );
  });
}
