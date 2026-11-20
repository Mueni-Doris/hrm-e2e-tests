import { test, expect, e2eName, confirmAlert } from '../helpers/fixtures';
import { findRow, rowAction, deleteRowsMatching } from '../helpers/table';
import { storageStatePath } from '../helpers/env';

const URL = '/manage/jobs/levels';
const name = e2eName('level');
const renamed = `${name}-edited`;

test.describe.serial('Job levels CRUD', () => {
  test('create a job level', async ({ page, serverErrors }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add New Level' }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Add New Job Level' });
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="title"]').fill(name);
    await dialog.getByRole('combobox').filter({ hasText: /Select Level Type/ }).click();
    await page.getByRole('option').first().click();
    await dialog.locator('input[name="startingSalary"]').fill('1000');
    await dialog.locator('input[name="maxSalary"]').fill('2000');
    await dialog.getByRole('button', { name: 'Create Job Level' }).click();

    await expect(page.getByText('Job level created successfully')).toBeVisible();
    await expect((await findRow(page, name)).first()).toBeVisible();
    expect(serverErrors).toEqual([]);
  });

  test('edit the job level', async ({ page }) => {
    await page.goto(URL);
    await rowAction(page, name, /^Edit$/);
    const dialog = page.getByRole('dialog').filter({ hasText: /Edit Job Level/ });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="title"]').fill(renamed);
    await dialog.getByRole('button', { name: 'Update Job Level' }).click();

    await expect(page.getByText('Job level updated successfully')).toBeVisible();
    await expect((await findRow(page, renamed)).first()).toBeVisible();
  });

  test('delete the job level', async ({ page }) => {
    await page.goto(URL);
    await rowAction(page, renamed, /Delete Job Level/);
    await confirmAlert(page);

    await expect(page.getByText('Job level deleted successfully!')).toBeVisible();
    await expect(await findRow(page, renamed)).toHaveCount(0);
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('employee') });
    await deleteRowsMatching(await ctx.newPage(), URL, 'E2E-level-', /Delete Job Level/);
    await ctx.close();
  });
});
