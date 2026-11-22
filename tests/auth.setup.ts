import { test as setup, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_URL, creds, hasCreds, storageStatePath, type Role } from './helpers/env';

/**
 * Login flow (Nov 2026: HRM uses Kiotapay SSO, like FMS):
 * HRM /login?returnTo=/manage → auth UI sign-in → optional 2FA "Skip and continue later" → back to /manage.
 * Fallback (old flow): if sign-in lands on the auth apps page instead, open HRM from its card.
 */
async function login(page: Page, role: Role): Promise<Page> {
  const { username, password } = creds(role);

  // Staging redirects can be slow (15s+ observed), so allow extra time for the SSO hop.
  await page.goto('/login?returnTo=%2Fmanage', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // The auth form renders after a "Loading" spinner; staging can be slow.
  await expect(page.locator('#usernameOrEmail'), 'Sign-in form did not load').toBeVisible({ timeout: 90_000 });
  await page.locator('#usernameOrEmail').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  const manage = /hr-app-frontend[^/]*\/manage(\/|$|\?)/;
  const skip = page.getByRole('button', { name: /skip and continue later/i })
    .or(page.getByRole('link', { name: /skip and continue later/i }));
  const hrmOpen = page.getByRole('link', { name: /^Open HRM\b/i });

  await expect.poll(async () => manage.test(page.url())
      || (await skip.first().isVisible().catch(() => false))
      || (await hrmOpen.isVisible().catch(() => false)),
    { timeout: 45_000, message: 'Sign-in reached neither HRM, the 2FA skip step nor the apps page' }).toBe(true);

  if (!manage.test(page.url()) && (await skip.first().isVisible().catch(() => false))) {
    await skip.first().click();
    await expect.poll(async () => manage.test(page.url()) || (await hrmOpen.isVisible().catch(() => false)),
      { timeout: 45_000 }).toBe(true);
  }
  if (manage.test(page.url())) return page;

  // Old flow: apps page → "Open HRM in a new tab".
  const popupPromise = page.context().waitForEvent('page', { timeout: 15_000 }).catch(() => null);
  await hrmOpen.click();
  const target = (await popupPromise) ?? page;
  await target.waitForURL(manage, { timeout: 60_000 });
  return target;
}

// Staging allows one session per account: a second login ends the first.
// When employee and approver are the same account, log in once and share it.
const sameAccount =
  hasCreds('employee') && hasCreds('approver') &&
  creds('employee').username.toLowerCase() === creds('approver').username.toLowerCase();

for (const role of ['employee', 'approver'] as const) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    setup.setTimeout(240_000);
    setup.skip(!hasCreds(role), `${role.toUpperCase()}_USERNAME / ${role.toUpperCase()}_PASSWORD not set in .env`);
    if (role === 'approver' && sameAccount) {
      // Setup tests run in file order, so the employee session already exists.
      fs.copyFileSync(storageStatePath('employee'), storageStatePath('approver'));
      return;
    }
    const hrPage = await login(page, role);
    fs.mkdirSync(path.dirname(storageStatePath(role)), { recursive: true });
    await hrPage.context().storageState({ path: storageStatePath(role) });
  });
}
