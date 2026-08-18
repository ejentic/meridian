import { getDb } from '../../../../../db/index';
import { requireRole, requireSession } from '../../../../../lib/authz';
import { notFound, respond, unprocessable } from '../../../../../lib/errors';
import { ROLES, assertManagerExists } from '../validate';

interface UserPatch {
  role?: unknown;
  managerId?: unknown;
}

/**
 * MR-PLT-01: assigning roles and maintaining `managerId` are Administrator only.
 *
 * This accepts `role` and `managerId` and nothing else, on purpose. The capability lists are
 * frozen as complete and no role holds a reactivate capability, so there must be no route
 * back from active = 0. Rejecting an unknown field rather than ignoring it is what makes
 * that structural: a request carrying `active` is refused with 422 and told why, instead of
 * appearing to succeed while silently doing nothing.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    // MR-PLT-01: user administration is Administrator-only, checked on the server per
    // MR-PLT-02 whether or not the interface renders a control.
    requireRole(principal, 'Administrator');

    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isInteger(userId)) throw unprocessable('User id must be an integer');

    const existing = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (existing === undefined) throw notFound('No such user');

    const body = (await request.json().catch(() => ({}))) as UserPatch;

    const unknownFields = Object.keys(body).filter((key) => key !== 'role' && key !== 'managerId');
    if (unknownFields.length > 0) {
      throw unprocessable(`Only role and managerId may be changed, not: ${unknownFields.join(', ')}`);
    }

    if ('role' in body) {
      if (!ROLES.includes(body.role as (typeof ROLES)[number])) {
        throw unprocessable(`role must be one of: ${ROLES.join(', ')}`);
      }
    }

    if ('managerId' in body) {
      const managerId = body.managerId;
      if (managerId !== null && !Number.isInteger(managerId)) {
        throw unprocessable('managerId must be an integer or null');
      }
      if (managerId === userId) {
        // MR-PLT-01 says a user whose managerId is null has no manager, and every check
        // phrased as "the subject's manager" fails closed for them. A user who is their own
        // manager fails open instead: they would become their own approver under MR-REV-03
        // and their own refund authority under MR-STO-08.
        throw unprocessable('A user cannot be their own manager');
      }
      if (managerId !== null) assertManagerExists(managerId as number);
    }

    // Nothing is written until every value has been validated, so a rejected patch leaves no
    // partial state behind.
    if ('role' in body) {
      getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role as string, userId);
    }
    if ('managerId' in body) {
      getDb()
        .prepare('UPDATE users SET manager_id = ? WHERE id = ?')
        .run(body.managerId as number | null, userId);
    }

    const updated = getDb()
      .prepare('SELECT id, email, full_name, role, manager_id, active FROM users WHERE id = ?')
      .get(userId);
    return Response.json(updated);
  });
}
