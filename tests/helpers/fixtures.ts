import { test as base, expect, type Page } from '@playwright/test';
import { hasSession, storageStatePath } from './env';

/**
 * Shared fixture for module tests: reuses the employee session (same login as
 * the Leave tests), fails fast on "Access Terminated", and records server errors.
 */
export const test = base.extend<{ serverErrors: string[] }>({
  storageState: async ({}, use) => {
    await use(storageStatePath('employee'));
  },
  serverErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 500 && /staging\.kiotapay\.com/.test(r.url())) {
        errors.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`);
      }
    });
    await use(errors);
  },
  page: async ({ page }, use) => {
    await page.addLocatorHandler(page.getByText('Access Terminated', { exact: true }), async () => {
      await page.getByRole('button', { name: /Logout Now/i }).click().catch(() => {});
      throw new Error('Session terminated ("Access Terminated"): the same account is signed in elsewhere. ' +
        'Sign out of it in your browser while tests run.');
    }, { noWaitAfter: true });
    await use(page);
  },
});

test.beforeEach(() => {
  test.skip(!hasSession('employee'), 'No session — set EMPLOYEE_USERNAME/PASSWORD in .env');
});

export { expect };

/** Unique, recognisable name for test data so leftovers are easy to spot and clean. */
export const e2eName = (what: string) => `E2E-${what}-${Date.now().toString(36)}`;

/** Clicks the confirm button in an open AlertDialog (anything but "Cancel"). */
export async function confirmAlert(page: Page) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button').filter({ hasNotText: /^\s*Cancel\s*$/ }).last().click();
}

/** Fills an input that sits next to its <label> (labels here have no htmlFor). */
export function inputNearLabel(page: Page, label: RegExp) {
  return page.locator('label', { hasText: label }).first()
    .locator('xpath=following::*[self::input or self::textarea][1]');
}
