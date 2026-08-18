import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE, SEED_PASSWORD, req, resetAndSeed, tokenFromResponse } from '../../../../test-support/fixture';
import { closeDb, getDb } from '../../../../db/index';
import { resetClock, setClock } from '../../../../lib/clock';
import { POST as signIn } from '../auth/signin/route';
import { GET as listEvaluations, POST as createEvaluation } from './route';
import { GET as readEvaluation } from './[id]/route';
import { POST as writeContent } from './[id]/content/route';
import { POST as transition } from './[id]/transitions/route';
import { GET as listCycles } from '../cycles/route';
import { POST as setCycleStatus } from '../cycles/[id]/status/route';

const AT = Date.UTC(2026, 7, 11, 9, 0, 0);

// Seeded users: 1 Administrator, 2 Manager (reports to 1), 3 and 4 Associates reporting to 2,
// 5 an Associate reporting to 1 rather than to 2.
// Seeded cycles: 1 Open, 2 Closed, 3 Planned.
const ADMIN = 1;
const MANAGER = 2;
const ASSOCIATE = 3;
const OTHER_ASSOCIATE = 4;
const OUTSIDE_REPORT = 5;
const OPEN_CYCLE = 1;
const CLOSED_CYCLE = 2;
const PLANNED_CYCLE = 3;

const EMAIL: Record<number, string> = {
  1: 'admin01@meridian-corp.test',
  2: 'manager01@meridian-corp.test',
  3: 'associate01@meridian-corp.test',
  4: 'associate02@meridian-corp.test',
  5: 'associate03@meridian-corp.test',
};

const GOOD_COMMENT = 'A comment that is comfortably longer than twenty characters.';
const GOOD_REASON = 'Please expand the Collaboration rating.';

beforeEach(() => {
  resetAndSeed();
  setClock(AT);
});

afterEach(() => {
  resetClock();
});

afterAll(() => {
  closeDb();
});

async function signInAs(userId: number): Promise<string> {
  const response = await signIn(
    req('POST', '/api/v1/auth/signin', { body: { email: EMAIL[userId], password: SEED_PASSWORD } })
  );
  return tokenFromResponse(response);
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

async function create(token: string, cycleId: number, subjectId: number): Promise<Response> {
  return createEvaluation(
    req('POST', '/api/v1/evaluations', { token, body: { cycleId, subjectId } })
  );
}

async function fire(
  token: string,
  evaluationId: number,
  event: string,
  returnReason?: string
): Promise<Response> {
  return transition(
    req('POST', `/api/v1/evaluations/${evaluationId}/transitions`, {
      token,
      body: { event, returnReason },
    }),
    params(evaluationId)
  );
}

function statusOf(evaluationId: number): string {
  return (
    getDb().prepare('SELECT status FROM evaluations WHERE id = ?').get(evaluationId) as {
      status: string;
    }
  ).status;
}

/** A Draft self evaluation by `subjectId`, fully rated and commented, ready to Submit. */
async function readyDraft(
  token: string,
  subjectId: number,
  ratings: number[] = [4, 4, 4, 3]
): Promise<number> {
  const created = await create(token, OPEN_CYCLE, subjectId);
  const id = (await created.json()).id as number;
  await writeContent(
    req('POST', `/api/v1/evaluations/${id}/content`, {
      token,
      body: {
        ratings: {
          'Quality of Work': ratings[0],
          Reliability: ratings[1],
          Collaboration: ratings[2],
          Initiative: ratings[3],
        },
        comment: GOOD_COMMENT,
      },
    }),
    params(id)
  );
  return id;
}

describe('the evaluation path, Draft to Approved', () => {
  it('runs a Self evaluation from Draft to Approved and on to Acknowledged', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    expect(statusOf(id)).toBe('Draft');

    expect((await fire(associate, id, 'Submit')).status).toBe(200);
    expect(statusOf(id)).toBe('Submitted');

    // On a Self evaluation the evaluator is the subject, so the subject's manager both
    // returns and approves it. Two different people are involved either way.
    const manager = await signInAs(MANAGER);
    expect((await fire(manager, id, 'Approve')).status).toBe(200);
    expect(statusOf(id)).toBe('Approved');

    expect((await fire(await signInAs(ASSOCIATE), id, 'Acknowledge')).status).toBe(200);
    expect(statusOf(id)).toBe('Acknowledged');
  });

  it('computes the overall score and band on the approved evaluation', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE, [4, 4, 4, 3]);
    await fire(associate, id, 'Submit');

    const response = await readEvaluation(
      req('GET', `/api/v1/evaluations/${id}`, { token: associate }),
      params(id)
    );
    const body = await response.json();
    expect(body.overallTenths).toBe(38);
    expect(body.overall).toBe(3.8);
    expect(body.band).toBe('Meets Expectations');
  });

  it('reports a null overall score and no band while a competency is unrated', async () => {
    const associate = await signInAs(ASSOCIATE);
    const created = await create(associate, OPEN_CYCLE, ASSOCIATE);
    const id = (await created.json()).id as number;

    const response = await readEvaluation(
      req('GET', `/api/v1/evaluations/${id}`, { token: associate }),
      params(id)
    );
    const body = await response.json();
    expect(body.overallTenths).toBeNull();
    expect(body.overall).toBeNull();
    expect(body.band).toBeNull();
  });
});

describe('MR-REV-01 rating validation at the API layer', () => {
  it.each([0, 6, 3.5, '4', null])('rejects %s with 422 and stores nothing', async (bad) => {
    const associate = await signInAs(ASSOCIATE);
    const created = await create(associate, OPEN_CYCLE, ASSOCIATE);
    const id = (await created.json()).id as number;

    const response = await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: associate,
        body: { ratings: { 'Quality of Work': bad } },
      }),
      params(id)
    );

    expect(response.status).toBe(422);
    expect((await response.json()).message).toMatch(/Quality of Work/);
    expect(
      getDb()
        .prepare("SELECT rating FROM competency_ratings WHERE evaluation_id = ? AND competency = 'Quality of Work'")
        .get(id)
    ).toEqual({ rating: null });
  });

  it('rejects the whole write when one competency in a batch is invalid', async () => {
    const associate = await signInAs(ASSOCIATE);
    const created = await create(associate, OPEN_CYCLE, ASSOCIATE);
    const id = (await created.json()).id as number;

    const response = await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: associate,
        body: { ratings: { 'Quality of Work': 4, Reliability: 9 } },
      }),
      params(id)
    );

    expect(response.status).toBe(422);
    // No partial write: the valid rating in the same batch was not stored either.
    expect(
      getDb()
        .prepare('SELECT rating FROM competency_ratings WHERE evaluation_id = ? ORDER BY competency')
        .all(id)
    ).toEqual([{ rating: null }, { rating: null }, { rating: null }, { rating: null }]);
  });
});

describe('MR-REV-03 transition guards', () => {
  it('refuses Submit until all four competencies are rated', async () => {
    const associate = await signInAs(ASSOCIATE);
    const created = await create(associate, OPEN_CYCLE, ASSOCIATE);
    const id = (await created.json()).id as number;
    await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: associate,
        body: { ratings: { 'Quality of Work': 4 }, comment: GOOD_COMMENT },
      }),
      params(id)
    );

    const response = await fire(associate, id, 'Submit');
    expect(response.status).toBe(422);
    expect(statusOf(id)).toBe('Draft');
  });

  it('refuses Submit with a comment under 20 characters and accepts it at 20', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);

    await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: associate,
        body: { comment: 'x'.repeat(19) },
      }),
      params(id)
    );
    expect((await fire(associate, id, 'Submit')).status).toBe(422);

    await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: associate,
        body: { comment: 'x'.repeat(20) },
      }),
      params(id)
    );
    expect((await fire(associate, id, 'Submit')).status).toBe(200);
  });

  it('refuses Return with a reason under 10 characters and accepts it at 10', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(associate, id, 'Submit');

    const manager = await signInAs(MANAGER);
    expect((await fire(manager, id, 'Return', 'x'.repeat(9))).status).toBe(422);
    expect(statusOf(id)).toBe('Submitted');

    expect((await fire(manager, id, 'Return', 'x'.repeat(10))).status).toBe(200);
    expect(statusOf(id)).toBe('Returned');
  });

  it('lets a Returned evaluation be edited and resubmitted', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(associate, id, 'Submit');
    await fire(await signInAs(MANAGER), id, 'Return', GOOD_REASON);

    const edit = await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: await signInAs(ASSOCIATE),
        body: { ratings: { Initiative: 5 } },
      }),
      params(id)
    );
    expect(edit.status).toBe(200);
    expect((await fire(await signInAs(ASSOCIATE), id, 'Submit')).status).toBe(200);
  });

  it('refuses the evaluator their own Approve and their own Return', async () => {
    // A Manager evaluating a direct report is the evaluator and is also the subject's
    // manager, so both guards bite and only an Administrator can move it on.
    const manager = await signInAs(MANAGER);
    const id = await readyDraft(manager, ASSOCIATE);
    await fire(manager, id, 'Submit');

    expect((await fire(manager, id, 'Approve')).status).toBe(403);
    expect((await fire(manager, id, 'Return', GOOD_REASON)).status).toBe(403);
    expect(statusOf(id)).toBe('Submitted');

    // Only an Administrator can, and an Administrator is also the only route by which a
    // manager who submitted a mistake gets it back into an editable status.
    const admin = await signInAs(ADMIN);
    expect((await fire(admin, id, 'Return', GOOD_REASON)).status).toBe(200);
    expect(statusOf(id)).toBe('Returned');
  });

  it('lets only the subject Acknowledge', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(associate, id, 'Submit');
    await fire(await signInAs(MANAGER), id, 'Approve');

    expect((await fire(await signInAs(MANAGER), id, 'Acknowledge')).status).toBe(403);
    expect((await fire(await signInAs(ADMIN), id, 'Acknowledge')).status).toBe(403);
    expect(statusOf(id)).toBe('Approved');

    expect((await fire(await signInAs(ASSOCIATE), id, 'Acknowledge')).status).toBe(200);
  });

  it('lets only an Administrator Cancel', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);

    expect((await fire(associate, id, 'Cancel')).status).toBe(403);
    expect(statusOf(id)).toBe('Draft');
    expect((await fire(await signInAs(ADMIN), id, 'Cancel')).status).toBe(200);
    expect(statusOf(id)).toBe('Cancelled');
  });
});

describe('MR-REV-03 invalid transitions are 409 and change nothing', () => {
  it.each([
    ['Draft to Approved', 'Approve'],
    ['Draft to Acknowledged', 'Acknowledge'],
  ])('rejects %s', async (_name, event) => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);

    const response = await fire(await signInAs(ADMIN), id, event);
    expect(response.status).toBe(409);
    expect(statusOf(id)).toBe('Draft');
  });

  it('rejects Submitted to Acknowledged', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(associate, id, 'Submit');

    expect((await fire(await signInAs(ASSOCIATE), id, 'Acknowledge')).status).toBe(409);
    expect(statusOf(id)).toBe('Submitted');
  });

  it('rejects every transition out of Cancelled', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(await signInAs(ADMIN), id, 'Cancel');

    for (const event of ['Submit', 'Approve', 'Return', 'Acknowledge', 'Cancel']) {
      const response = await fire(await signInAs(ADMIN), id, event, GOOD_REASON);
      expect(response.status, `${event} out of Cancelled`).toBe(409);
    }
    expect(statusOf(id)).toBe('Cancelled');
  });

  it('rejects a content write in Submitted with 409, including an identical value', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE, [4, 4, 4, 3]);
    await fire(associate, id, 'Submit');

    const response = await writeContent(
      req('POST', `/api/v1/evaluations/${id}/content`, {
        token: await signInAs(ASSOCIATE),
        // The same value the rating already holds. Still a 409.
        body: { ratings: { 'Quality of Work': 4 } },
      }),
      params(id)
    );
    expect(response.status).toBe(409);
  });
});

describe('MR-REV-06 cycle status and its precedence over MR-REV-03', () => {
  it('lets only an Administrator change cycle status, Planned to Open to Closed', async () => {
    const associate = await signInAs(ASSOCIATE);
    expect(
      (
        await setCycleStatus(
          req('POST', `/api/v1/cycles/${PLANNED_CYCLE}/status`, { token: associate, body: { status: 'Open' } }),
          params(PLANNED_CYCLE)
        )
      ).status
    ).toBe(403);

    const admin = await signInAs(ADMIN);
    expect(
      (
        await setCycleStatus(
          req('POST', `/api/v1/cycles/${PLANNED_CYCLE}/status`, { token: admin, body: { status: 'Open' } }),
          params(PLANNED_CYCLE)
        )
      ).status
    ).toBe(200);
  });

  it('refuses to reopen a Closed cycle with 409', async () => {
    const admin = await signInAs(ADMIN);
    const response = await setCycleStatus(
      req('POST', `/api/v1/cycles/${CLOSED_CYCLE}/status`, { token: admin, body: { status: 'Open' } }),
      params(CLOSED_CYCLE)
    );
    expect(response.status).toBe(409);
  });

  it('returns 422 and not 409 for an invalid transition inside a Closed cycle', async () => {
    // This is the interaction the rule calls the point. There is exactly one correct status
    // code for this request, and it is the cycle's 422, not the transition's 409.
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);

    const admin = await signInAs(ADMIN);
    await setCycleStatus(
      req('POST', `/api/v1/cycles/${OPEN_CYCLE}/status`, { token: admin, body: { status: 'Closed' } }),
      params(OPEN_CYCLE)
    );

    // Draft to Acknowledged is invalid on its own terms and would be 409 in an Open cycle.
    const response = await fire(await signInAs(ADMIN), id, 'Acknowledge');
    expect(response.status).toBe(422);
    expect(statusOf(id)).toBe('Draft');
  });

  it('stops an Approved evaluation being Acknowledged once its cycle closes', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(associate, id, 'Submit');
    await fire(await signInAs(MANAGER), id, 'Approve');

    const admin = await signInAs(ADMIN);
    await setCycleStatus(
      req('POST', `/api/v1/cycles/${OPEN_CYCLE}/status`, { token: admin, body: { status: 'Closed' } }),
      params(OPEN_CYCLE)
    );

    // Deliberate, and mirrors MR-FIN-02: a closed period stops accepting writes regardless
    // of what the record-level workflow would permit.
    const response = await fire(await signInAs(ASSOCIATE), id, 'Acknowledge');
    expect(response.status).toBe(422);
    expect(statusOf(id)).toBe('Approved');
  });
});

describe('MR-REV-04 the eligibility decision table', () => {
  it('rule 1: rejects any creation in a cycle that is not Open, with 422', async () => {
    const associate = await signInAs(ASSOCIATE);
    for (const cycle of [CLOSED_CYCLE, PLANNED_CYCLE]) {
      const response = await create(associate, cycle, ASSOCIATE);
      expect(response.status, `cycle ${cycle}`).toBe(422);
    }
  });

  it('rule 1 outranks permission: an Associate evaluating someone else in a closed cycle gets 422', async () => {
    // Cycle state is checked first, so the caller sees the cycle error and not the 403 that
    // rule 4 would give in an Open cycle. This is the precedence the rule fixes.
    const associate = await signInAs(ASSOCIATE);
    const response = await create(associate, CLOSED_CYCLE, OTHER_ASSOCIATE);
    expect(response.status).toBe(422);
  });

  it('rule 2: permits a Self evaluation for any role', async () => {
    for (const userId of [ADMIN, MANAGER, ASSOCIATE]) {
      const token = await signInAs(userId);
      const response = await create(token, OPEN_CYCLE, userId);
      expect(response.status, `user ${userId}`).toBe(201);
      const id = (await response.json()).id as number;
      expect(
        getDb().prepare('SELECT type FROM evaluations WHERE id = ?').get(id)
      ).toEqual({ type: 'Self' });
    }
  });

  it('rule 3: rejects a duplicate Self evaluation with 409', async () => {
    const associate = await signInAs(ASSOCIATE);
    expect((await create(associate, OPEN_CYCLE, ASSOCIATE)).status).toBe(201);
    expect((await create(associate, OPEN_CYCLE, ASSOCIATE)).status).toBe(409);
  });

  it('rule 4: rejects an Associate evaluating anyone else with 403', async () => {
    const associate = await signInAs(ASSOCIATE);
    expect((await create(associate, OPEN_CYCLE, OTHER_ASSOCIATE)).status).toBe(403);
  });

  it('rule 4 outranks duplication: an Associate sees 403 whether or not one exists', async () => {
    const manager = await signInAs(MANAGER);
    await create(manager, OPEN_CYCLE, ASSOCIATE);

    const associate = await signInAs(ASSOCIATE);
    expect((await create(associate, OPEN_CYCLE, OTHER_ASSOCIATE)).status).toBe(403);
  });

  it('rule 5: permits a Manager evaluating a direct report, as type Manager', async () => {
    const manager = await signInAs(MANAGER);
    const response = await create(manager, OPEN_CYCLE, ASSOCIATE);
    expect(response.status).toBe(201);
    const id = (await response.json()).id as number;
    expect(getDb().prepare('SELECT type FROM evaluations WHERE id = ?').get(id)).toEqual({
      type: 'Manager',
    });
  });

  it('rule 6: rejects a duplicate Manager evaluation with 409', async () => {
    const manager = await signInAs(MANAGER);
    expect((await create(manager, OPEN_CYCLE, ASSOCIATE)).status).toBe(201);
    expect((await create(manager, OPEN_CYCLE, ASSOCIATE)).status).toBe(409);
  });

  it('rule 7: rejects a Manager evaluating someone who is not their direct report', async () => {
    const manager = await signInAs(MANAGER);
    // A peer's report rather than their own.
    expect((await create(manager, OPEN_CYCLE, OUTSIDE_REPORT)).status).toBe(403);
    // Their own manager, which is the skip-level case in the other direction.
    expect((await create(manager, OPEN_CYCLE, ADMIN)).status).toBe(403);
  });

  it('rule 7 outranks duplication: permission is checked before C5', async () => {
    const manager = await signInAs(MANAGER);
    expect((await create(manager, OPEN_CYCLE, OUTSIDE_REPORT)).status).toBe(403);
    // Still 403 on a second attempt, never 409, because the check never reaches C5.
    expect((await create(manager, OPEN_CYCLE, OUTSIDE_REPORT)).status).toBe(403);
  });

  it('rule 8: permits an Administrator evaluating anyone, as type Manager', async () => {
    const admin = await signInAs(ADMIN);
    // Not a direct report of the Administrator in the sense rule 5 requires, and permitted
    // anyway: rule 8 does not consult C4.
    const response = await create(admin, OPEN_CYCLE, ASSOCIATE);
    expect(response.status).toBe(201);
    const id = (await response.json()).id as number;
    expect(getDb().prepare('SELECT type FROM evaluations WHERE id = ?').get(id)).toEqual({
      type: 'Manager',
    });
  });

  it('rule 9: rejects an Administrator duplicate with 409', async () => {
    const admin = await signInAs(ADMIN);
    expect((await create(admin, OPEN_CYCLE, ASSOCIATE)).status).toBe(201);
    expect((await create(admin, OPEN_CYCLE, ASSOCIATE)).status).toBe(409);
  });

  it('lets a cancelled evaluation be created again, because C5 excludes Cancelled', async () => {
    const associate = await signInAs(ASSOCIATE);
    const first = await create(associate, OPEN_CYCLE, ASSOCIATE);
    expect(first.status).toBe(201);
    const id = (await first.json()).id as number;

    // While it is live, a second is a duplicate.
    expect((await create(await signInAs(ASSOCIATE), OPEN_CYCLE, ASSOCIATE)).status).toBe(409);

    await fire(await signInAs(ADMIN), id, 'Cancel');
    expect(statusOf(id)).toBe('Cancelled');

    // Cancelled, so the combination is free again. This is the route by which a mistaken
    // evaluation gets redone inside the same cycle.
    expect((await create(await signInAs(ASSOCIATE), OPEN_CYCLE, ASSOCIATE)).status).toBe(201);
  });

  it('keys duplication on evaluator as well as subject, so two people may evaluate one subject', async () => {
    const manager = await signInAs(MANAGER);
    expect((await create(manager, OPEN_CYCLE, ASSOCIATE)).status).toBe(201);

    const admin = await signInAs(ADMIN);
    expect((await create(admin, OPEN_CYCLE, ASSOCIATE)).status).toBe(201);
  });
});

describe('MR-REV-05 read access', () => {
  it('lets the evaluator read their own evaluation in every status', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: associate }), params(id)))
        .status
    ).toBe(200);
  });

  it('hides a Manager-type evaluation from its subject until it is Approved', async () => {
    const manager = await signInAs(MANAGER);
    const id = await readyDraft(manager, ASSOCIATE);

    const subject = await signInAs(ASSOCIATE);
    const draft = await readEvaluation(
      req('GET', `/api/v1/evaluations/${id}`, { token: subject }),
      params(id)
    );
    expect(draft.status).toBe(403);
    // The refusal carries no ratings, no comment, and no overall score.
    const body = await draft.json();
    expect(body).not.toHaveProperty('ratings');
    expect(body).not.toHaveProperty('comment');
    expect(body).not.toHaveProperty('overall');

    await fire(manager, id, 'Submit');
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: await signInAs(ASSOCIATE) }), params(id)))
        .status
    ).toBe(403);

    await fire(await signInAs(ADMIN), id, 'Approve');
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: await signInAs(ASSOCIATE) }), params(id)))
        .status
    ).toBe(200);
  });

  it('refuses an unrelated Associate entirely', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);

    const other = await signInAs(OTHER_ASSOCIATE);
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: other }), params(id)))
        .status
    ).toBe(403);
  });

  it('gives the subject manager every status except Draft, Returned, and Cancelled', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);

    // Draft: refused.
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: await signInAs(MANAGER) }), params(id)))
        .status
    ).toBe(403);

    await fire(associate, id, 'Submit');
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: await signInAs(MANAGER) }), params(id)))
        .status
    ).toBe(200);

    await fire(await signInAs(MANAGER), id, 'Return', GOOD_REASON);
    // Returned: refused again, which means a manager who returns an evaluation cannot then
    // read the return reason they just wrote. Recorded in the ambiguity log.
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: await signInAs(MANAGER) }), params(id)))
        .status
    ).toBe(403);
  });

  it('lets an Administrator read every status', async () => {
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    expect(
      (await readEvaluation(req('GET', `/api/v1/evaluations/${id}`, { token: await signInAs(ADMIN) }), params(id)))
        .status
    ).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------
// The Reviews read surface a screen needs. MR-REV-05's scope is status-dependent, so the
// list is not the same shape as the order list: which rows a caller sees changes as the
// evaluations move, and a list that ignored status would leak exactly what the rule forbids.

describe('GET /evaluations applies MR-REV-05 row by row', () => {
  /** A Draft Manager-type evaluation of `associate01`, authored by `manager01`. */
  async function draftManagerEvaluation(): Promise<number> {
    const manager = await signInAs(MANAGER);
    const created = await create(manager, OPEN_CYCLE, ASSOCIATE);
    return (await created.json()).id as number;
  }

  async function idsVisibleTo(userId: number): Promise<number[]> {
    const token = await signInAs(userId);
    const response = await listEvaluations(req('GET', '/api/v1/evaluations', { token }));
    expect(response.status).toBe(200);
    return (await response.json()).evaluations.map((e: { id: number }) => e.id);
  }

  it('shows a Draft to its evaluator', async () => {
    const id = await draftManagerEvaluation();
    expect(await idsVisibleTo(MANAGER)).toEqual([id]);
  });

  it('hides a Draft Manager-type evaluation from its subject', async () => {
    await draftManagerEvaluation();
    // MR-REV-05: the subject reads a Manager-type evaluation only once it is Approved or
    // Acknowledged. Draft is the evaluator still working.
    expect(await idsVisibleTo(ASSOCIATE)).toEqual([]);
  });

  it('hides it from an unrelated Associate', async () => {
    await draftManagerEvaluation();
    expect(await idsVisibleTo(OTHER_ASSOCIATE)).toEqual([]);
  });

  it('shows it to an Administrator, who reads every status', async () => {
    const id = await draftManagerEvaluation();
    expect(await idsVisibleTo(ADMIN)).toEqual([id]);
  });

  it('shows it to the subject once it is Approved', async () => {
    const manager = await signInAs(MANAGER);
    const id = await readyDraft(manager, ASSOCIATE);
    await fire(manager, id, 'Submit');

    expect(await idsVisibleTo(ASSOCIATE)).toEqual([]);

    // The evaluator is the subject's manager here, so MR-REV-03's not-the-evaluator guard
    // leaves the Administrator as the only approver.
    const admin = await signInAs(ADMIN);
    expect((await fire(admin, id, 'Approve')).status).toBe(200);

    expect(await idsVisibleTo(ASSOCIATE)).toEqual([id]);
  });

  it('hides a Returned evaluation from the subject manager who returned it', async () => {
    // The consequence MR-REV-05 states outright: returning it moves it into a status the
    // returner's own read access excludes. Only an Administrator can still read it.
    const associate = await signInAs(ASSOCIATE);
    const id = await readyDraft(associate, ASSOCIATE);
    await fire(associate, id, 'Submit');

    const manager = await signInAs(MANAGER);
    expect((await fire(manager, id, 'Return', GOOD_REASON)).status).toBe(200);

    expect(await idsVisibleTo(MANAGER)).toEqual([]);
    expect(await idsVisibleTo(ADMIN)).toEqual([id]);
  });

  it('never lists an evaluation the detail read would refuse', async () => {
    // The list and the detail must agree, for the same reason the order list and detail
    // must. MR-REV-05 is the only scope, and it is applied in one place.
    const manager = await signInAs(MANAGER);
    await create(manager, OPEN_CYCLE, ASSOCIATE);
    const associate = await signInAs(ASSOCIATE);
    await create(associate, OPEN_CYCLE, ASSOCIATE);
    const other = await signInAs(OTHER_ASSOCIATE);
    await create(other, OPEN_CYCLE, OTHER_ASSOCIATE);

    for (const userId of [ADMIN, MANAGER, ASSOCIATE, OTHER_ASSOCIATE, OUTSIDE_REPORT]) {
      const token = await signInAs(userId);
      const listed = (await (
        await listEvaluations(req('GET', '/api/v1/evaluations', { token }))
      ).json()) as { evaluations: { id: number }[] };

      for (const evaluation of listed.evaluations) {
        const detail = await readEvaluation(
          req('GET', `/api/v1/evaluations/${evaluation.id}`, { token }),
          params(evaluation.id)
        );
        expect(detail.status).toBe(200);
      }
    }
  });

  it('carries no ratings, no comment, and no overall score', async () => {
    // MR-REV-05 governs those fields and a list is a read like any other. A caller who may
    // read them asks for the evaluation.
    const id = await draftManagerEvaluation();
    const token = await signInAs(MANAGER);
    const response = await listEvaluations(req('GET', '/api/v1/evaluations', { token }));

    const { evaluations } = await response.json();
    expect(Object.keys(evaluations[0]).sort()).toEqual([
      'cycleId',
      'evaluatorId',
      'id',
      'status',
      'subjectId',
      'type',
    ]);
    expect(evaluations[0]).toEqual({
      id,
      cycleId: OPEN_CYCLE,
      subjectId: ASSOCIATE,
      evaluatorId: MANAGER,
      type: 'Manager',
      status: 'Draft',
    });
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await listEvaluations(new Request(`${BASE}/api/v1/evaluations`));
    expect(response.status).toBe(401);
  });
});

describe('GET /cycles', () => {
  it('returns all three seeded cycles to every role', async () => {
    for (const userId of [ADMIN, MANAGER, ASSOCIATE]) {
      const token = await signInAs(userId);
      const response = await listCycles(req('GET', '/api/v1/cycles', { token }));

      expect(response.status).toBe(200);
      const { cycles } = await response.json();
      expect(cycles).toHaveLength(3);
      expect(cycles[0]).toEqual({
        id: 1,
        name: '2026 Annual Review',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'Open',
      });
      // MR-REV-06: the statuses are what a screen needs in order to know which cycle an
      // evaluation may be created in.
      expect(cycles.map((c: { status: string }) => c.status)).toEqual(['Open', 'Closed', 'Planned']);
    }
  });

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await listCycles(new Request(`${BASE}/api/v1/cycles`));
    expect(response.status).toBe(401);
  });
});
