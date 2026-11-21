import { expect, type Locator, type Page } from '@playwright/test';
import { confirmAlert } from './fixtures';

/**
 * Filters a DataTable by its search box (if any) and returns the matching rows.
 * Typing before React hydrates gets wiped, so the fill is retried until it sticks
 * (and, when `expectPresent`, until a matching row shows up).
 */
export async function findRow(page: Page, text: string, expectPresent = true): Promise<Locator> {
  const rows = page.getByRole('row').filter({ hasText: text });
  await page.waitForLoadState('networkidle').catch(() => {});
  const search = page.getByRole('searchbox').first();
  if (await search.isVisible().catch(() => false)) {
    await expect(async () => {
      await search.fill(text);
      await page.waitForTimeout(500);
      await expect(search).toHaveValue(text, { timeout: 1_000 });
      if (expectPresent) await expect(rows.first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  return rows;
}

/**
 * Opens a row's "Open menu" and clicks the item matching `item`.
 * Some tables re-render after load (resetting the search filter / reshuffling rows),
 * so the whole search -> open menu -> click sequence is retried as one unit.
 */
export async function rowAction(page: Page, text: string, item: RegExp) {
  const menuItem = page.getByRole('menuitem', { name: item });
  await expect(async () => {
    await page.keyboard.press('Escape');
    const row = (await findRow(page, text)).first();
    await row.getByRole('button', { name: 'Open menu' }).click({ timeout: 3_000 });
    await menuItem.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

/** Deletes every row whose text matches `prefix` via the row menu. Best-effort, never throws. */
export async function deleteRowsMatching(page: Page, url: string, prefix: string, deleteItem: RegExp) {
  try {
    for (let i = 0; i < 10; i++) {
      await page.goto(url);
      const row = (await findRow(page, prefix, false)).first();
      if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) return;
      await rowAction(page, prefix, deleteItem);
      await confirmAlert(page);
      await page.waitForLoadState('networkidle').catch(() => {});
    }
  } catch { /* best-effort cleanup */ }
}
