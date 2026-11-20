import { test, expect, e2eName, confirmAlert } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
import { storageStatePath } from '../helpers/env';

const URL = '/manage/departments';
const name = e2eName('dept');
const renamed = `${name}-edited`;

const node = (page: Page, n: string) => page.getByRole('button', { name: new RegExp(`^${n}\\b`) });

async function deptAction(page: Page, n: string, item: RegExp) {
  await page.getByRole('button', { name: `Actions for ${n}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe.serial('Departments CRUD', () => {
  test('create a department', async ({ page, serverErrors }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add Department', exact: true }).click();
    await page.getByPlaceholder('Department name').fill(name);
    await page.getByPlaceholder('Description (optional)').fill('Created by automated E2E test');
    await page.getByRole('button', { name: 'Add department', exact: true }).click();

    await expect(node(page, name)).toBeVisible();
    expect(serverErrors).toEqual([]);
  });

  test('edit the department', async ({ page }) => {
    await page.goto(URL);
    await deptAction(page, name, /^Edit/);
    const input = page.getByPlaceholder('Department name');
    await expect(input).toHaveValue(name);
    await input.fill(renamed);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(node(page, renamed)).toBeVisible();
  });

  test('delete the department', async ({ page }) => {
    await page.goto(URL);
    await deptAction(page, renamed, /^Delete/);
    await confirmAlert(page);

    await expect(node(page, renamed)).toHaveCount(0);
  });

  test.afterAll(async ({ browser }) => {
    // Cleanup any E2E department left by a failed step (or earlier runs).
    const ctx = await browser.newContext({ storageState: storageStatePath('employee') });
    const page = await ctx.newPage();
    try {
      for (let i = 0; i < 10; i++) {
        await page.goto(URL);
        await page.waitForLoadState('networkidle').catch(() => {});
        const actions = page.getByRole('button', { name: /^Actions for E2E-dept-/ }).first();
        if (!(await actions.isVisible({ timeout: 5_000 }).catch(() => false))) break;
        await actions.click();
        await page.getByRole('menuitem', { name: /^Delete/ }).click();
        await confirmAlert(page);
        await page.waitForLoadState('networkidle').catch(() => {});
      }
    } catch { /* best-effort */ }
    await ctx.close();
  });
});
