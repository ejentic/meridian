import { getDb } from '../../../../db/index';
import { requireSession } from '../../../../lib/authz';
import { respond } from '../../../../lib/errors';

/**
 * Readable by any live session, whatever its role.
 *
 * The full name and email address are the caller's own record and are here because the shell
 * header identifies who is signed in. MR-PLT-01 lets every role read themselves, so this
 * grants nothing new, and it deliberately returns nothing about any other user.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    const principal = requireSession(request);
    const identity = getDb()
      .prepare('SELECT full_name, email FROM users WHERE id = ?')
      .get(principal.userId) as { full_name: string; email: string };

    return Response.json({ ...principal, fullName: identity.full_name, email: identity.email });
  });
}
