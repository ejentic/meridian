import { getDb } from '../../../../../../db/index';
import { requireRole, requireSession } from '../../../../../../lib/authz';
import { notFound, respond, unprocessable } from '../../../../../../lib/errors';
import { deleteSessionsForUser } from '../../../../../../lib/session';

/**
 * MR-PLT-01: an Administrator may end any user's session.
 *
 * This is not deactivation and must not be mistaken for it. The user stays active and may
 * sign in again immediately; what ends is every session they currently hold. MR-PLT-05 is
 * what makes it observable: the deleted record means their next request returns 401 rather
 * than their next sign-in being refused.
 */
export async function DELETE(
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

    deleteSessionsForUser(userId);

    return new Response(null, { status: 204 });
  });
}
