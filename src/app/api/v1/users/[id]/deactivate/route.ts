import { getDb, inTransaction } from '../../../../../../db/index';
import { requireRole, requireSession } from '../../../../../../lib/authz';
import { notFound, respond, unprocessable } from '../../../../../../lib/errors';
import { deleteSessionsForUser } from '../../../../../../lib/session';

/**
 * MR-PLT-05. Deactivation ends the user's active sessions immediately, so their next
 * request returns 401 rather than their next sign-in being refused. The deactivation and
 * the session deletion go in one transaction: a user marked inactive whose sessions survived
 * would still be refused by getSession, but leaving the rows behind would mean the database
 * disagrees with itself about who is signed in.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    requireRole(principal, 'Administrator');

    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isInteger(userId)) throw unprocessable('User id must be an integer');

    const exists = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (exists === undefined) throw notFound('No such user');

    inTransaction(() => {
      getDb().prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);
      deleteSessionsForUser(userId);
    });

    return new Response(null, { status: 204 });
  });
}
