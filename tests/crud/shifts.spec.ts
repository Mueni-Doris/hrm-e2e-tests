import { test, expect, e2eName, confirmAlert } from '../helpers/fixtures';
import { findRow, rowAction, deleteRowsMatching } from '../helpers/table';
import { storageStatePath } from '../helpers/env';

const URL = '/manage/attendance/shifts';
const name = e2eName('shift');
const renamed = `${name}-edited`;

test.describe.serial('Shifts CRUD', () => {
  test('create a shift', async ({ page, serverErrors }) => {
    await page.goto(`${URL}/create`);
    await page.locator('input[name="title"]').fill(name);
    await page.locator('input[name="startTime"]').fill('08:00');
    await page.locator('input[name="endTime"]').fill('17:00');
    await page.getByPlaceholder('Describe this shift...').fill('Created by automated E2E test');
    await page.getByRole('button', { name: 'Create Shift' }).click();

    await expect(page.getByText(/shift .*(created|saved)/i).first()).toBeVisible();
    await page.goto(URL);
    await expect((await findRow(page, name)).first()).toBeVisible();
    expect(serverErrors).toEqual([]);
  });

  test('edit the shift', async ({ page }) => {
    await page.goto(URL);
    await rowAction(page, name, /^Edit$/);
    const title = page.locator('input[name="title"]');
    await expect(title).toHaveValue(name);
    await title.fill(renamed);
    await page.getByRole('button', { name: 'Update Shift' }).click();

    await expect(page.getByText(/shift .*updated/i).first()).toBeVisible();
    await page.goto(URL);
    await expect((await findRow(page, renamed)).first()).toBeVisible();
  });

  test('delete the shift', async ({ page }) => {
    await page.goto(URL);
    await rowAction(page, renamed, /Delete Shift/);
    await confirmAlert(page);

    await expect(page.getByText('Shift deleted successfully!')).toBeVisible();
    await expect(await findRow(page, renamed)).toHaveCount(0);
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('employee') });
    await deleteRowsMatching(await ctx.newPage(), URL, 'E2E-shift-', /Delete Shift/);
    await ctx.close();
  });
});
