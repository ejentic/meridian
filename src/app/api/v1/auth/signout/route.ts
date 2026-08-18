import { SESSION_COOKIE, readToken } from '../../../../../lib/authz';
import { respond } from '../../../../../lib/errors';
import { deleteSession } from '../../../../../lib/session';

/**
 * MR-PLT-04. Deletes the server-side record, so a token another tab still holds stops
 * working on that tab's next request rather than at its next sign-in.
 *
 * Signing out is deliberately not gated on the session still being valid: an already
 * expired token should not produce a 401 on the way out.
 */
export async function POST(request: Request): Promise<Response> {
  return respond(() => {
    const token = readToken(request);
    // MR-PLT-04: the server-side record is deleted, not only the browser cookie, so a token
    // another tab still holds stops authenticating on that tab's next request.
    if (token !== null) deleteSession(token);

    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
    });
  });
}
