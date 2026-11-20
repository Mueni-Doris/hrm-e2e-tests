import { expect, type Locator, type Page } from '@playwright/test';
import { confirmAlert } from './fixtures';

/** Filters a DataTable by its search box (if any) and returns the matching row. */
export async function findRow(page: Page, text: string): Promise<Locator> {
  const search = page.locator('input[type="search"]').first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill(text);
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  return page.getByRole('row').filter({ hasText: text });
}

/** Opens a row's "Open menu" and clicks the item matching `item`. */
export async function rowAction(page: Page, text: string, item: RegExp) {
  const row = (await findRow(page, text)).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Deletes every row whose text matches `prefix` via the row menu. Best-effort, never throws. */
export async function deleteRowsMatching(page: Page, url: string, prefix: string, deleteItem: RegExp) {
  try {
    for (let i = 0; i < 10; i++) {
      await page.goto(url);
      const row = (await findRow(page, prefix)).first();
      if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) return;
      await row.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: deleteItem }).click();
      await confirmAlert(page);
      await page.waitForLoadState('networkidle').catch(() => {});
    }
  } catch { /* best-effort cleanup */ }
}
