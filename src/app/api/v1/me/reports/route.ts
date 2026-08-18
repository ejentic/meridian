import { getDb } from '../../../../../db/index';
import { requireSession } from '../../../../../lib/authz';
import { respond } from '../../../../../lib/errors';

/**
 * MR-PLT-01 as amended 2026-08-11. The caller's own direct reports.
 *
 * Open to any live session and not gated on role. An Associate gets an empty array with 200
 * rather than a 403, because having nobody report to you is an ordinary fact about an
 * organisation and not a refusal.
 *
 * The columns are the amendment's: id, full name, role. No email and no managerId, because
 * this is a read of who reports to the caller and not user administration, which stays
 * Administrator-only. Widening this response would quietly turn it into a second user list
 * that every role can read.
 *
 * Note what this does not answer. It returns people, not permissions. MR-REV-04 decides who
 * the caller may evaluate and MR-STO-08 decides whose orders they may refund, and both of
 * those decisions stay where the rules put them. Per MR-PLT-02 the interface applies those
 * rules itself to what this returns, and this endpoint must not be changed to apply them on
 * the interface's behalf.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    const principal = requireSession(request);

    const reports = getDb()
      .prepare('SELECT id, full_name AS fullName, role FROM users WHERE manager_id = ? ORDER BY id')
      .all(principal.userId);

    return Response.json({ reports });
  });
}
