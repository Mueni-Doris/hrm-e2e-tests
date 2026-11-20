import { test, expect, e2eName, confirmAlert } from '../helpers/fixtures';
import { findRow, rowAction, deleteRowsMatching } from '../helpers/table';
import { storageStatePath } from '../helpers/env';

const URL = '/manage/leaves/leave-types';
const name = e2eName('leavetype');
const renamed = `${name}-edited`;

test.describe.serial('Leave types CRUD', () => {
  test('create a leave type', async ({ page, serverErrors }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add New Leave Type' }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Add New Leave Type' });
    await expect(dialog).toBeVisible();

    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="allocationDays"]').fill('1');
    await dialog.locator('input[name="accrualDays"]').fill('1');
    await dialog.locator('input[name="minDaysPerRequest"]').fill('1');
    const notice = dialog.locator('input[name="noticePeriodDays"]');
    if (await notice.count()) await notice.fill('0');
    const probation = dialog.locator('input[name="minProbationMonths"]');
    if (await probation.count()) await probation.fill('0');
    // Description is a required rich-text editor.
    const description = dialog.locator('[contenteditable="true"]').first();
    await description.click();
    await description.pressSequentially('Created by automated E2E test');
    await dialog.getByRole('button', { name: /Create Leave Type/ }).click();

    await expect(page.getByText('Leave type created successfully')).toBeVisible();
    await expect((await findRow(page, name)).first()).toBeVisible();
    expect(serverErrors).toEqual([]);
  });

  test('edit the leave type', async ({ page }) => {
    await page.goto(URL);
    await rowAction(page, name, /^Edit$/);
    const dialog = page.getByRole('dialog').filter({ hasText: /Edit Leave Type/ });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="name"]').fill(renamed);
    await dialog.getByRole('button', { name: 'Update Leave Type' }).click();

    await expect(page.getByText('Leave type updated successfully')).toBeVisible();
    await expect((await findRow(page, renamed)).first()).toBeVisible();
  });

  test('delete the leave type', async ({ page }) => {
    await page.goto(URL);
    await rowAction(page, renamed, /Delete Leave Type/);
    await confirmAlert(page);

    await expect(page.getByText('Leave type deleted successfully!')).toBeVisible();
    await expect(await findRow(page, renamed)).toHaveCount(0);
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('employee') });
    await deleteRowsMatching(await ctx.newPage(), URL, 'E2E-leavetype-', /Delete Leave Type/);
    await ctx.close();
  });
});
