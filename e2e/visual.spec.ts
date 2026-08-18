import { test, expect } from '@playwright/test';
import { EMAIL, resetFixture, signInAs } from './support/paired';

/**
 * Visual regression baseline for Meridian's main screens. Kept separate from the functional
 * specs so a pixel-diff failure (a font substitution, a spacing tweak) never masks or gets
 * masked by a behavioral assertion in the same test.
 *
 * First run (or after an intentional UI change) needs `--update-snapshots` to (re)write the
 * baseline PNGs under `visual.spec.ts-snapshots/`; commit those alongside the change they
 * capture.
 */
test.describe('visual', () => {
  test.beforeEach(async ({ request }) => {
    await resetFixture(request);
  });

  async function snapshot(page: import('@playwright/test').Page, name: string) {
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(name, { animations: 'disabled', fullPage: true });
  }

  test('signin', async ({ page }) => {
    await page.goto('/signin');
    await snapshot(page, 'signin.png');
  });

  test('products', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await snapshot(page, 'products.png');
  });

  test('cart', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/cart');
    await snapshot(page, 'cart.png');
  });

  test('orders', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/orders');
    await snapshot(page, 'orders.png');
  });

  test('evaluations', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/evaluations');
    await snapshot(page, 'evaluations.png');
  });

  test('cycles', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/cycles');
    await snapshot(page, 'cycles.png');
  });

  test('account password', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/account/password');
    await snapshot(page, 'account-password.png');
  });

  test('admin users', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/users');
    await snapshot(page, 'admin-users.png');
  });

  test('admin products', async ({ page }) => {
    await signInAs(page, EMAIL.admin);
    await page.goto('/admin/products');
    await snapshot(page, 'admin-products.png');
  });
});
