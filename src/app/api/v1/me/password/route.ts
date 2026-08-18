import { randomUUID } from 'node:crypto';
import { getDb } from '../../../../../db/index';
import { hashPassword } from '../../../../../db/seed';
import { requireSession } from '../../../../../lib/authz';
import { ApiError, respond, unprocessable } from '../../../../../lib/errors';

/**
 * MR-PLT-01 as amended 2026-08-11. Any authenticated user changes their own password.
 *
 * No complexity rule is enforced, which follows from the rule's statement that credentials
 * are deliberately unspecified rather than being a separate decision.
 *
 * Existing sessions survive, including the caller's. MR-PLT-03 names two session limits, the
 * idle one and the absolute one, and a password change is neither. A user who wants their
 * other sessions ended asks an Administrator, which is a capability MR-PLT-01 grants and
 * DELETE /users/[id]/sessions serves.
 */
export async function POST(request: Request): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);

    const body = (await request.json().catch(() => ({}))) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      throw unprocessable('currentPassword and newPassword are required');
    }
    if (body.newPassword.length === 0) throw unprocessable('newPassword must not be empty');

    const user = getDb()
      .prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
      .get(principal.userId) as { password_hash: string; password_salt: string };

    if (hashPassword(body.currentPassword, user.password_salt) !== user.password_hash) {
      // 401, matching what sign-in returns for the same mistake. This is the one place in
      // the application where 401 answers something other than the session state MR-PLT-02
      // describes, and the amendment names it explicitly for that reason. The session the
      // request arrived on is untouched: a failed change is not a reason to end it.
      throw new ApiError(401, 'unauthorized', 'Current password is incorrect');
    }

    // A fresh salt, so two users who choose the same password still store different digests.
    const salt = randomUUID();
    getDb()
      .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
      .run(hashPassword(body.newPassword, salt), salt, principal.userId);

    return new Response(null, { status: 204 });
  });
}
