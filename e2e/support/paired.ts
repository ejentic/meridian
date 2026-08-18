import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const SEED_PASSWORD = 'meridian';

/** Restores the seeded state. Every spec file calls this in test.beforeEach. */
export async function resetFixture(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/v1/test/reset');
  expect(response.status()).toBe(204);
}

export const EMAIL = {
  admin: 'admin01@meridian-corp.test',
  manager: 'manager01@meridian-corp.test',
  associate: 'associate01@meridian-corp.test',
  associate2: 'associate02@meridian-corp.test',
  outsider: 'associate03@meridian-corp.test',
} as const;

/** Seeded user ids, so a spec can name a subject without querying for one. */
export const USER_ID = {
  admin: 1,
  manager: 2,
  associate: 3,
  associate2: 4,
  outsider: 5,
} as const;

/** Signs in through the interface and lands on the products page. */
export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/products/);
}

/** Signs in over HTTP and returns the session token, for calling the API directly. */
export async function tokenFor(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post('/api/v1/auth/signin', {
    data: { email, password: SEED_PASSWORD },
  });
  expect(response.status()).toBe(200);
  const cookie = response.headers()['set-cookie'];
  const match = /meridian_session=([^;]+)/.exec(cookie);
  if (!match) throw new Error(`no session cookie in: ${cookie}`);
  return match[1];
}

/**
 * MR-PLT-02's paired test, as one call.
 *
 * Asserts the control is absent for this role AND that the endpoint refuses the same role
 * calling it directly. Both halves are required: the first is what the interface can get
 * wrong, the second is what the API can get wrong, and they fail independently. A test that
 * only asserts the control is missing proves nothing about enforcement.
 *
 * `controlRole` exists because not every control is a button. A navigation entry the
 * Administrator alone should see is a link, and asserting no button by that name would pass
 * whether or not the link was there, which is a test that cannot fail.
 */
export async function expectRefusedBothWays(
  page: Page,
  request: APIRequestContext,
  options: {
    email: string;
    controlName: string | RegExp;
    controlRole?: 'button' | 'link';
    method: 'get' | 'post' | 'patch' | 'delete';
    path: string;
    body?: unknown;
    expectedStatus: 403 | 409 | 422;
  }
): Promise<void> {
  // Settle before asserting absence. A screen composes its controls from more than one fetch:
  // the order detail decides the heading and the rows, and the caller's own identity and
  // direct reports arrive separately, so a control gated on those renders later than the
  // anchor each caller of this helper waits on. Without this, toHaveCount(0) is satisfied by
  // the window before the control would have appeared, and the assertion passes whether the
  // rule is enforced or not.
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole(options.controlRole ?? 'button', { name: options.controlName })).toHaveCount(0);

  const token = await tokenFor(request, options.email);
  const response = await request[options.method](`/api/v1${options.path}`, {
    headers: { cookie: `meridian_session=${token}` },
    ...(options.body === undefined ? {} : { data: options.body }),
  });
  expect(response.status()).toBe(options.expectedStatus);
}
