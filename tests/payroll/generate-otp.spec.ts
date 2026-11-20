import { test, expect, e2eName } from '../helpers/fixtures';

/**
 * Payroll generation stops at the OTP step, by design of this suite: we never
 * verify an OTP or approve payroll. In the app, nothing is generated until the
 * OTP is verified, so cancelling leaves no payroll run behind.
 * Note: reaching the dialog sends one OTP email to the test account.
 */
test('generate payroll reaches the OTP step and cancel creates nothing', async ({ page, serverErrors }) => {
  const title = e2eName('payroll');

  await page.goto('/manage/payroll/generated');
  await page.getByRole('button', { name: /Generate Payroll/ }).click();

  const genDialog = page.getByRole('dialog').filter({ hasText: 'Generate Payrolls' });
  await expect(genDialog).toBeVisible();
  const titleInput = genDialog.locator('input').first();
  await titleInput.fill(title);
  await genDialog.getByRole('button', { name: /^Generate$/ }).click();

  const otp = page.getByRole('dialog').filter({ hasText: 'Verify Your Identity' });
  await expect(otp, 'OTP dialog should open instead of generating directly').toBeVisible();
  await expect(otp.getByRole('button', { name: 'Verify OTP' })).toBeDisabled();

  await otp.getByRole('button', { name: 'Cancel' }).click();
  await expect(otp).toBeHidden();

  // Nothing was generated.
  await page.reload();
  await page.getByPlaceholder('Search by payroll title').fill(title);
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
  expect(serverErrors).toEqual([]);
});
