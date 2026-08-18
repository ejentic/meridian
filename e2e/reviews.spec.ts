import { expect, test, type Page } from '@playwright/test';
import {
  EMAIL,
  USER_ID,
  expectRefusedBothWays,
  resetFixture,
  signInAs,
  tokenFor,
} from './support/paired';

// MR-REV-01 through MR-REV-06 in a browser. The transition controls are the most
// defect-prone visibility logic in the application, because MR-REV-03's "who may fire it"
// column is five distinct rules and each one is a different answer for a different caller
// looking at the same evaluation.

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

const GOOD_COMMENT = 'A comment that is comfortably longer than twenty characters.';
const RATINGS = ['Quality of Work', 'Reliability', 'Collaboration', 'Initiative'] as const;

/** Creates an evaluation of `subjectName` in the Open cycle and lands on its detail screen. */
async function createEvaluation(page: Page, subjectName: string): Promise<string> {
  await page.goto('/evaluations/new');
  await page.getByLabel('Cycle').selectOption({ label: '2026 Annual Review' });
  await page.getByLabel('Subject').selectOption({ label: subjectName });
  await page.getByRole('button', { name: 'Create evaluation' }).click();

  await expect(page).toHaveURL(/\/evaluations\/\d+/);
  return /\/evaluations\/(\d+)/.exec(page.url())![1];
}

async function rateAndComment(page: Page, ratings: number[], comment = GOOD_COMMENT): Promise<void> {
  for (const [index, competency] of RATINGS.entries()) {
    await page.getByLabel(competency).selectOption(String(ratings[index]));
  }
  await page.getByLabel('Comment').fill(comment);
  await page.getByRole('button', { name: 'Save content' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();
}

test('takes a Self evaluation from Draft to Acknowledged and shows 3.8 Meets Expectations', async ({
  page,
}) => {
  await signInAs(page, EMAIL.associate);
  const id = await createEvaluation(page, 'Casey Lim');

  await rateAndComment(page, [4, 4, 4, 3]);

  // MR-REV-02: 15 / 4 = 3.75, which rounds half-up to 3.8, and 3.8 lands in Meets
  // Expectations because that band runs from 3.0 to 4.4 inclusive.
  await expect(page.getByTestId('overall')).toHaveText('3.8');
  await expect(page.getByTestId('band')).toHaveText('Meets Expectations');

  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('evaluation-status')).toHaveText('Submitted');

  // The evaluator is the subject on a Self evaluation, so the subject's manager both returns
  // and approves it. Two different people are involved either way.
  await signInAs(page, EMAIL.manager);
  await page.goto(`/evaluations/${id}`);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('evaluation-status')).toHaveText('Approved');

  await signInAs(page, EMAIL.associate);
  await page.goto(`/evaluations/${id}`);
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByTestId('evaluation-status')).toHaveText('Acknowledged');
});

test('MR-REV-02: bands exactly 4.5 as Exceeds Expectations', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await createEvaluation(page, 'Casey Lim');

  await rateAndComment(page, [5, 5, 4, 4]);

  // MR-REV-02: 18 / 4 = 4.5, and both band edges are inclusive on the lower side, so 4.5 is
  // the first value of Exceeds Expectations rather than the last of Meets Expectations. The
  // rule enumerates seventeen reachable overall values, which makes this a boundary the rule
  // names rather than one a tester invented. The score and the band are asserted together
  // because the band alone cannot distinguish a misbanded 4.5 from a correctly banded 4.4.
  await expect(page.getByTestId('overall')).toHaveText('4.5');
  await expect(page.getByTestId('band')).toHaveText('Exceeds Expectations');
});

test('shows no overall score and no band while a competency is unrated', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await createEvaluation(page, 'Casey Lim');

  // Three of four rated. MR-REV-02: the overall is null, and null is neither displayed as
  // 0.0 nor treated as a rating of zero in the mean.
  for (const competency of RATINGS.slice(0, 3)) {
    await page.getByLabel(competency).selectOption('4');
  }
  await page.getByLabel('Comment').fill(GOOD_COMMENT);
  await page.getByRole('button', { name: 'Save content' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();

  await expect(page.getByTestId('overall')).toHaveText('Not yet scored');
  await expect(page.getByTestId('band')).toHaveText('Not yet scored');

  // The control is present, because MR-REV-03 lists Submit from Draft for the evaluator and
  // the guard is a guard, not a permission. The refusal has to come from the server.
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('error-banner')).toContainText('422');
  await expect(page.getByTestId('evaluation-status')).toHaveText('Draft');
});

test('MR-REV-01: the screen offers 1 to 5 only, and the server refuses anything else', async ({
  page,
  request,
}) => {
  await signInAs(page, EMAIL.associate);
  const id = await createEvaluation(page, 'Casey Lim');

  // The interface cannot express an invalid rating: the select carries exactly the five the
  // rule allows. That is presentation, so the enforcement half goes at the API directly.
  await expect(page.getByLabel('Collaboration').getByRole('option')).toHaveText([
    'Unrated',
    '1',
    '2',
    '3',
    '4',
    '5',
  ]);

  const token = await tokenFor(request, EMAIL.associate);
  const response = await request.post(`/api/v1/evaluations/${id}/content`, {
    headers: { cookie: `meridian_session=${token}` },
    data: { ratings: { Collaboration: 6 } },
  });

  expect(response.status()).toBe(422);
  // MR-REV-01: the refusal names the offending competency and changes no stored value.
  expect((await response.json()).message).toContain('Collaboration');

  await page.reload();
  await expect(page.getByLabel('Collaboration')).toHaveValue('');
});

test('MR-REV-01: the server refuses a non-integer rating', async ({ page, request }) => {
  await signInAs(page, EMAIL.associate);
  const id = await createEvaluation(page, 'Casey Lim');

  // The test above sends 6, which is out of range. MR-REV-01 defines a rating as an integer
  // from 1 to 5, and the integer half needs its own case: a value inside the range that is
  // not an integer is the one a range check alone lets through.
  const token = await tokenFor(request, EMAIL.associate);
  const response = await request.post(`/api/v1/evaluations/${id}/content`, {
    headers: { cookie: `meridian_session=${token}` },
    data: { ratings: { Reliability: 3.5 } },
  });

  expect(response.status()).toBe(422);
  expect((await response.json()).message).toContain('Reliability');

  await page.reload();
  await expect(page.getByLabel('Reliability')).toHaveValue('');
});

test('MR-REV-03: the evaluator cannot approve their own submission, both ways', async ({
  page,
  request,
}) => {
  // A Manager-type evaluation authored by manager01. The evaluator is the subject's manager,
  // so the not-the-evaluator guard leaves an Administrator as the only approver.
  await signInAs(page, EMAIL.manager);
  const id = await createEvaluation(page, 'Casey Lim');
  await rateAndComment(page, [4, 4, 4, 3]);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('evaluation-status')).toHaveText('Submitted');

  // Anchor: the evaluator is looking at their own submitted evaluation, which they may read
  // in every status, so an absent Approve is the guard rather than a failed read.
  await expect(page.getByTestId('evaluation-status')).toHaveText('Submitted');

  await expectRefusedBothWays(page, request, {
    email: EMAIL.manager,
    controlName: 'Approve',
    method: 'post',
    path: `/evaluations/${id}/transitions`,
    body: { event: 'Approve' },
    expectedStatus: 403,
  });

  // Return carries the same guard, for the same reason: an evaluator who could return their
  // own submission could edit and resubmit it with nobody else reading it.
  await expectRefusedBothWays(page, request, {
    email: EMAIL.manager,
    controlName: 'Return',
    method: 'post',
    path: `/evaluations/${id}/transitions`,
    body: { event: 'Return', returnReason: 'Please expand the Collaboration rating.' },
    expectedStatus: 403,
  });

  // The Administrator can, which is what makes the evaluation reachable at all.
  await signInAs(page, EMAIL.admin);
  await page.goto(`/evaluations/${id}`);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('evaluation-status')).toHaveText('Approved');
});

test('MR-REV-03: only an Administrator may cancel, both ways', async ({ page, request }) => {
  await signInAs(page, EMAIL.associate);
  const id = await createEvaluation(page, 'Casey Lim');

  for (const email of [EMAIL.associate, EMAIL.manager]) {
    await signInAs(page, email);
    await page.goto(`/evaluations/${id}`);
    // Anchor on the heading, not on the status. MR-REV-05 keeps the subject's manager out
    // of a Draft, so manager01 correctly sees a 403 and no status here. The anchor's job is
    // to prove the screen rendered, so an absent Cancel is a decision.
    await expect(page.getByRole('heading', { name: `Evaluation ${id}` })).toBeVisible();

    await expectRefusedBothWays(page, request, {
      email,
      controlName: 'Cancel',
      method: 'post',
      path: `/evaluations/${id}/transitions`,
      body: { event: 'Cancel' },
      expectedStatus: 403,
    });
  }

  await signInAs(page, EMAIL.admin);
  await page.goto(`/evaluations/${id}`);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('evaluation-status')).toHaveText('Cancelled');
});

test('MR-REV-05: the subject cannot read a Manager-type evaluation before it is Approved', async ({
  page,
}) => {
  await signInAs(page, EMAIL.manager);
  const id = await createEvaluation(page, 'Casey Lim');

  await signInAs(page, EMAIL.associate);
  await page.goto('/evaluations');
  await expect(page.getByRole('row', { name: new RegExp(`^${id} `) })).toHaveCount(0);

  await page.goto(`/evaluations/${id}`);
  await expect(page.getByTestId('error-banner')).toContainText('403');
});

test('MR-REV-04: the subject picker offers only subjects the rule permits', async ({ page }) => {
  // An Associate may evaluate themselves and nobody else, per rule 4.
  await signInAs(page, EMAIL.associate);
  await page.goto('/evaluations/new');
  await expect(page.getByLabel('Subject').getByRole('option')).toHaveText(['Casey Lim']);

  // A Manager may evaluate themselves and their direct reports, per rules 2 and 5. Emery Tan
  // reports to the Administrator, so rule 7 excludes them.
  await signInAs(page, EMAIL.manager);
  await page.goto('/evaluations/new');
  await expect(page.getByLabel('Subject').getByRole('option')).toHaveText([
    'Blair Santos',
    'Casey Lim',
    'Devon Reyes',
  ]);

  // An Administrator may evaluate anyone, per rules 2 and 8.
  await signInAs(page, EMAIL.admin);
  await page.goto('/evaluations/new');
  await expect(page.getByLabel('Subject').getByRole('option')).toHaveCount(5);
});

test('MR-REV-04 rule 7: the server refuses a subject the picker never offered', async ({
  request,
}) => {
  // The picker applies the rule and so does the server, independently. This is the half that
  // proves the refusal does not depend on an absent option.
  const token = await tokenFor(request, EMAIL.manager);

  const response = await request.post('/api/v1/evaluations', {
    headers: { cookie: `meridian_session=${token}` },
    data: { cycleId: 1, subjectId: USER_ID.outsider },
  });
  expect(response.status()).toBe(403);
});

test('MR-REV-06: an Administrator opens a Planned cycle and closes an Open one', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/cycles');

  const planned = page.getByRole('row', { name: /2027 Annual Review/ });
  await planned.getByRole('button', { name: 'Open cycle' }).click();
  await expect(planned).toContainText('Open');

  const open = page.getByRole('row', { name: /2026 Annual Review/ });
  await open.getByRole('button', { name: 'Close cycle' }).click();
  await expect(open).toContainText('Closed');

  // Closed is terminal and a cycle cannot be reopened.
  await expect(open.getByRole('button', { name: 'Open cycle' })).toHaveCount(0);
});

for (const role of [
  { name: 'Manager', email: EMAIL.manager },
  { name: 'Associate', email: EMAIL.associate },
]) {
  test(`MR-REV-06: refuses ${role.name} a cycle status change, both ways`, async ({
    page,
    request,
  }) => {
    await signInAs(page, role.email);
    await page.goto('/cycles');

    // The screen has to have rendered before "the control is absent" means anything. Without
    // this anchor the assertion also passes on a page that failed to load, which is a test
    // that cannot fail for the reason it claims to be checking.
    await expect(page.getByRole('row', { name: /2026 Annual Review/ })).toBeVisible();

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'Close cycle',
      method: 'post',
      path: '/cycles/1/status',
      body: { status: 'Closed' },
      expectedStatus: 403,
    });
  });
}

test('MR-REV-06: a Closed cycle refuses a write with 422, not the 409 the transition would give', async ({
  page,
}) => {
  await signInAs(page, EMAIL.associate);
  const id = await createEvaluation(page, 'Casey Lim');
  await rateAndComment(page, [4, 4, 4, 3]);

  await signInAs(page, EMAIL.admin);
  await page.goto('/cycles');
  await page
    .getByRole('row', { name: /2026 Annual Review/ })
    .getByRole('button', { name: 'Close cycle' })
    .click();
  await expect(page.getByRole('row', { name: /2026 Annual Review/ })).toContainText('Closed');

  // The cycle check runs before the transition check, so this is 422 for the closed cycle
  // and not the 409 MR-REV-03 would give on its own.
  await signInAs(page, EMAIL.associate);
  await page.goto(`/evaluations/${id}`);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByTestId('error-banner')).toContainText('422');
});
