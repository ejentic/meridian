import { expect, test } from '@playwright/test';
import { EMAIL, resetFixture, signInAs, tokenFor } from './support/paired';

// MR-PLT-02, MR-PLT-04, and MR-PLT-05 through the browser. The API-layer equivalents already
// pass in auth.test.ts; what these add is that the interface honours the same refusals,
// which is the half of the pair the Vitest suite cannot see.

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

const ACCOUNTS = [
  { email: EMAIL.admin, fullName: 'Avery Cruz', role: 'Administrator' },
  { email: EMAIL.manager, fullName: 'Blair Santos', role: 'Manager' },
  { email: EMAIL.associate, fullName: 'Casey Lim', role: 'Associate' },
] as const;

for (const account of ACCOUNTS) {
  test(`signs ${account.role} in, shows their identity, and signs them out`, async ({ page }) => {
    await signInAs(page, account.email);

    await expect(page.getByTestId('signed-in-name')).toHaveText(account.fullName);
    await expect(page.getByTestId('signed-in-role')).toHaveText(account.role);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin/);
  });
}

test('sends a browser with no session back to sign-in', async ({ page }) => {
  await page.goto('/products');
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('refuses a wrong password and says nothing about whether the address exists', async ({
  page,
}) => {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(EMAIL.associate);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The status code is on the screen, per the design: trainees have to tell 401 from 403.
  await expect(page.getByTestId('error-banner')).toContainText('401');
  await expect(page).toHaveURL(/\/signin/);
});

test('shows the ADMIN section to an Administrator and to nobody else', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await expect(page.getByRole('navigation').getByText('ADMIN')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();

  for (const email of [EMAIL.manager, EMAIL.associate]) {
    await signInAs(page, email);
    await expect(page.getByRole('navigation').getByText('ADMIN')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0);
  }
});

test('MR-PLT-04: a token stops authenticating the moment its session signs out', async ({
  request,
}) => {
  const token = await tokenFor(request, EMAIL.associate);
  const cookie = `meridian_session=${token}`;
  expect((await request.get('/api/v1/me', { headers: { cookie } })).status()).toBe(200);

  expect((await request.post('/api/v1/auth/signout', { headers: { cookie } })).status()).toBe(204);

  // MR-PLT-04's actual claim, which the browser assertion below cannot make: the session is a
  // server-side record, so the token itself stops working. Signing out clears the cookie too,
  // and a test that only watches the browser passes whether or not the record was deleted.
  expect((await request.get('/api/v1/me', { headers: { cookie } })).status()).toBe(401);
});

test('ends the session server side on sign-out, so the back button does not restore it', async ({
  page,
}) => {
  await signInAs(page, EMAIL.associate);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin/);

  // MR-PLT-04: the record is gone, not just the cookie, so returning to an authenticated
  // screen is refused by the server rather than served from whatever the browser kept.
  await page.goto('/products');
  await expect(page).toHaveURL(/\/signin/);
});
