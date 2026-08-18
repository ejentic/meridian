import { getDb } from '../../../../db/index';
import { requireSession } from '../../../../lib/authz';
import { respond } from '../../../../lib/errors';

/**
 * MR-REV-06. Readable by any live session.
 *
 * Only an Administrator changes a cycle's status, and that is a different endpoint. Every
 * role needs to read the list, because MR-REV-04 condition C1 makes the cycle's status the
 * first thing that decides whether an evaluation may be created in it, so a screen offering
 * a cycle has to know which ones are Open.
 *
 * The dates are returned because the rule names them, and they constrain nothing: a Planned
 * cycle may be opened before its start date and an Open cycle stays open past its end date
 * until an Administrator closes it. They look like controls and are not.
 */
export async function GET(request: Request): Promise<Response> {
  return respond(() => {
    requireSession(request);

    const cycles = getDb()
      .prepare(
        `SELECT id, name, start_date AS startDate, end_date AS endDate, status
           FROM review_cycles
          ORDER BY id`
      )
      .all();

    return Response.json({ cycles });
  });
}
