import { resetDb } from '../../../../../db/index';
import { seed } from '../../../../../db/seed';
import { notFound, respond } from '../../../../../lib/errors';

/**
 * Test-only. Returns 404 unless MERIDIAN_TEST_MODE=1, so it does not exist as far as a
 * trainee or a facilitator is concerned. 404 rather than 403 on purpose: a 403 would tell a
 * caller the endpoint is real and merely refused, which is a hint the fixture should not
 * give during a defect-hunting exercise.
 *
 * The reset has to run in this process. The dev server holds the database open, so a reset
 * issued from outside would drop the tables underneath a connection that is still pointing
 * at them. That is why this exists rather than the db:reset CLI serving both purposes.
 */
export async function POST(): Promise<Response> {
  return respond(() => {
    if (process.env.MERIDIAN_TEST_MODE !== '1') throw notFound();
    resetDb();
    seed();
    return new Response(null, { status: 204 });
  });
}
