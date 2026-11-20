import { test as setup, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_URL, creds, hasCreds, storageStatePath, type Role } from './helpers/env';

/**
 * Login flow (source of truth, CLAUDE.md):
 * Auth login → 2FA → "Skip and continue later" → All Apps → "Kiotapay HR & Payroll" → /manage
 */
async function login(page: Page, role: Role): Promise<Page> {
  const { username, password } = creds(role);

  await page.goto(`${AUTH_URL}/auth/login`);
  await page.locator('#usernameOrEmail').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Apps page: a card per product ("HRM", "Kiotapay FMS V2", ...), each with an "Open" button.
  // 2FA may show as a full "Skip and continue later" step, or only as a banner on this page.
  const hrmTitle = page.getByText('HRM', { exact: true });
  const skip = page.getByRole('button', { name: /skip and continue later/i })
    .or(page.getByRole('link', { name: /skip and continue later/i }));
  await expect(hrmTitle.or(skip).first(), 'Neither the 2FA skip step nor the apps page appeared after sign-in')
    .toBeVisible({ timeout: 30_000 });
  if (await skip.first().isVisible()) await skip.first().click();

  // Deepest element that contains both the "HRM" title and an "Open" control = the HRM card.
  const openCtl = page.getByRole('button', { name: /^Open/ }).or(page.getByRole('link', { name: /^Open/ }));
  const hrmCard = page.locator('div').filter({ has: hrmTitle }).filter({ has: openCtl }).last();
  await expect(hrmCard, 'HRM card not found on the apps page').toBeVisible({ timeout: 30_000 });
  const popupPromise = page.context().waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  await hrmCard.locator(openCtl).first().click();
  const target = (await popupPromise) ?? page;

  await target.waitForURL(/\/manage(\/|$|\?)/, { timeout: 60_000 });
  return target;
}

// Staging allows one session per account: a second login ends the first.
// When employee and approver are the same account, log in once and share it.
const sameAccount =
  hasCreds('employee') && hasCreds('approver') &&
  creds('employee').username.toLowerCase() === creds('approver').username.toLowerCase();

for (const role of ['employee', 'approver'] as const) {
  setup(`authenticate as ${role}`, async ({ page }) => {
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
