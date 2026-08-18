import { requireSession } from '../../../../../../lib/authz';
import { respond, unprocessable } from '../../../../../../lib/errors';
import { type CycleStatus, setCycleStatus } from '../../../../../../lib/evaluation';

const STATUSES: readonly CycleStatus[] = ['Planned', 'Open', 'Closed'];

/** MR-REV-06. Planned to Open and Open to Closed. Closed is terminal. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  return respond(async () => {
    const principal = requireSession(request);
    const { id } = await context.params;

    const body = (await request.json().catch(() => ({}))) as { status?: unknown };
    if (!STATUSES.includes(body.status as CycleStatus)) {
      throw unprocessable(`status must be one of: ${STATUSES.join(', ')}`);
    }

    setCycleStatus(principal, Number(id), body.status as CycleStatus);
    return Response.json({ status: body.status });
  });
}
