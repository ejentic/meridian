import { expect, test } from '@playwright/test';
import { EMAIL, expectRefusedBothWays, resetFixture, signInAs } from './support/paired';

// MR-PLT-01's Platform column through the browser, and MR-PLT-02's paired test applied to
// every control on it. The half that asserts a missing control is what the interface can get
// wrong; the half that calls the endpoint is what the API can get wrong.

test.beforeEach(async ({ request }) => {
  await resetFixture(request);
});

test('lets an Administrator see all five seeded users', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.getByRole('link', { name: 'Users' }).click();

  await expect(page).toHaveURL(/\/users/);
  await expect(page.getByRole('row')).toHaveCount(6); // header plus five users
  await expect(page.getByRole('cell', { name: 'Casey Lim' })).toBeVisible();
});

test('creates a user, and that user can sign in', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/users/new');

  await page.getByLabel('Email').fill('associate04@meridian-corp.test');
  await page.getByLabel('Full name').fill('Frankie Vo');
  await page.getByLabel('Password').fill('starter');
  await page.getByLabel('Role').selectOption('Associate');
  await page.getByLabel('Manager').selectOption('2');
  await page.getByRole('button', { name: 'Create user' }).click();

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole('cell', { name: 'Frankie Vo' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/signin');
  await page.getByLabel('Email').fill('associate04@meridian-corp.test');
  await page.getByLabel('Password').fill('starter');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/products/);
});

test('changes a role and the change persists', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/users/3');

  await page.getByLabel('Role').selectOption('Manager');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Role')).toHaveValue('Manager');
});

test('deactivates a user, and the row shows them inactive', async ({ page }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/users/4');

  await page.getByRole('button', { name: 'Deactivate user' }).click();
  await expect(page.getByTestId('active-state')).toHaveText('Inactive');

  // MR-PLT-01: deactivation is one way, so there is no control to undo it.
  await expect(page.getByRole('button', { name: /Reactivate/ })).toHaveCount(0);

  await page.goto('/users');
  await expect(page.getByRole('row', { name: /Devon Reyes/ })).toContainText('Inactive');
});

test('ends another user session from the interface', async ({ page, request }) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/users/3');

  await page.getByRole('button', { name: 'End sessions' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();

  // Not deactivation: the user is still active and may sign in again.
  await expect(page.getByTestId('active-state')).toHaveText('Active');
});

// MR-PLT-02 paired tests. Each asserts the control is absent AND that the endpoint refuses
// the same role calling it directly, because those two fail independently.

for (const role of [
  { name: 'Manager', email: EMAIL.manager },
  { name: 'Associate', email: EMAIL.associate },
]) {
  test(`refuses ${role.name} the users list, both in the interface and at the API`, async ({
    page,
    request,
  }) => {
    await signInAs(page, role.email);
    // Anchor: the shell has to have rendered before "the Users link is absent" means
    // anything. Without it the assertion also passes on a page that never loaded.
    await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'Users',
      controlRole: 'link',
      method: 'get',
      path: '/users',
      expectedStatus: 403,
    });
  });

  test(`refuses ${role.name} deactivation, both in the interface and at the API`, async ({
    page,
    request,
  }) => {
    // Navigating straight to the screen, not merely finding no link to it. A control that is
    // only unreachable by navigation is still rendered, and this is the difference.
    await signInAs(page, role.email);
    await page.goto('/users/3');
    // Anchor: the screen rendered and refused the read, so the missing controls below are
    // controls this role was not given rather than a page that failed to load.
    await expect(page.getByTestId('error-banner')).toContainText('403');

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'Deactivate user',
      method: 'post',
      path: '/users/3/deactivate',
      expectedStatus: 403,
    });
  });

  test(`refuses ${role.name} ending another user session, both ways`, async ({ page, request }) => {
    await signInAs(page, role.email);
    await page.goto('/users/3');
    // Anchor: the screen rendered and refused the read, so the missing controls below are
    // controls this role was not given rather than a page that failed to load.
    await expect(page.getByTestId('error-banner')).toContainText('403');

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'End sessions',
      method: 'delete',
      path: '/users/3/sessions',
      expectedStatus: 403,
    });
  });

  test(`refuses ${role.name} changing another user role, both ways`, async ({ page, request }) => {
    await signInAs(page, role.email);
    await page.goto('/users/3');
    // Anchor: the screen rendered and refused the read, so the missing controls below are
    // controls this role was not given rather than a page that failed to load.
    await expect(page.getByTestId('error-banner')).toContainText('403');

    await expectRefusedBothWays(page, request, {
      email: role.email,
      controlName: 'Save changes',
      method: 'patch',
      path: '/users/3',
      body: { role: 'Administrator' },
      expectedStatus: 403,
    });
  });
}

test('lets every role change their own password', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await page.goto('/account/password');

  await page.getByLabel('Current password').fill('meridian');
  await page.getByLabel('New password').fill('a-new-one');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();

  // MR-PLT-03 names two session limits and a password change is neither, so this session
  // survives the change and the user is not bounced to sign-in.
  await expect(page.getByTestId('signed-in-name')).toHaveText('Casey Lim');
});

test('shows the status code when the current password is wrong', async ({ page }) => {
  await signInAs(page, EMAIL.associate);
  await page.goto('/account/password');

  await page.getByLabel('Current password').fill('not-the-password');
  await page.getByLabel('New password').fill('a-new-one');
  await page.getByRole('button', { name: 'Change password' }).click();

  await expect(page.getByTestId('error-banner')).toContainText('401');
});

test('MR-PLT-05: an Administrator who demotes themselves is refused on the very next navigation', async ({
  page,
}) => {
  await signInAs(page, EMAIL.admin);
  await page.goto('/users/1');

  await page.getByLabel('Role').selectOption('Associate');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('saved')).toBeVisible();

  // No new sign-in and no reload of the session. The role is re-read from the user record on
  // every request, so the next one is refused even though the interface still believes it is
  // talking to an Administrator.
  await page.goto('/users');
  await expect(page.getByTestId('error-banner')).toContainText('403');
  await expect(page.getByRole('cell', { name: 'Casey Lim' })).toHaveCount(0);
});
