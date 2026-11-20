import { test, expect, type Browser } from '@playwright/test';
import { hasSession, missing, storageStatePath, type Role } from '../helpers/env';
import {
  ROUTES, SUCCESS_APPLY, applyLeaveOnFreeDay, deleteMyLeave, fillLeaveForm, leaveIdFromMyLeaves,
  myLeaveRow, openApplyForm, pastWeekday, randomWeekday, submit,
} from '../helpers/leave';

const LEAVE_TYPE = process.env.LEAVE_TYPE ?? '';

async function pageAs(browser: Browser, role: Role) {
  const ctx = await browser.newContext({ storageState: storageStatePath(role) });
  const page = await ctx.newPage();
  // Staging allows one session per account. If the same account signs in elsewhere
  // (e.g. in your own browser), the app shows "Access Terminated" with a countdown.
  // Click "Logout Now" and fail fast with a clear reason instead of timing out.
  await page.addLocatorHandler(page.getByText('Access Terminated', { exact: true }), async () => {
    await page.getByRole('button', { name: /Logout Now/i }).click().catch(() => {});
    throw new Error(
      `Session for ${role} was terminated ("Access Terminated"): the same account is signed in elsewhere. ` +
      'Use a dedicated test account, or sign out of it in your browser while tests run.');
  }, { noWaitAfter: true });
  return { ctx, page };
}

test.describe('Leave Management', () => {

  // Dates created by a test; cleaned up (deleted while PENDING) afterwards.
  let created: string[] = [];

  test.beforeEach(() => {
    test.skip(!hasSession('employee'), 'No employee session — set EMPLOYEE_USERNAME/PASSWORD in .env');
    const m = missing('LEAVE_TYPE');
    test.skip(Boolean(m), `Missing in .env: ${m}`);
    created = [];
  });

  test.afterEach(async ({ browser }) => {
    if (!created.length || !hasSession('employee')) return;
    const { ctx, page } = await pageAs(browser, 'employee');
    for (const d of created) await deleteMyLeave(page, d);
    await ctx.close();
  });

  // ───────────── happy paths ─────────────

  test('employee can apply for leave', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, 'employee');
    const day = await applyLeaveOnFreeDay(page, LEAVE_TYPE);
    created.push(day);

    const row = myLeaveRow(page, day).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/pending/i);
    await ctx.close();
  });

  test('approver can approve a pending leave', async ({ browser }) => {
    test.skip(!hasSession('approver'), 'No approver session — set APPROVER_USERNAME/PASSWORD in .env');
    const emp = await pageAs(browser, 'employee');
    const day = await applyLeaveOnFreeDay(emp.page, LEAVE_TYPE);
    created.push(day); // no-op once approved (only PENDING can be deleted)
    const id = await leaveIdFromMyLeaves(emp.page, day);

    const appr = await pageAs(browser, 'approver');
    await appr.page.goto(ROUTES.approval(id));
    await appr.page.getByRole('button', { name: 'Approve Leave' }).click();
    await expect(appr.page.getByText('Leave approved successfully!')).toBeVisible();
    await appr.page.waitForURL(/\/manage\/leaves\/pending-approval/);

    // Assumes a single approver is configured for the employee's job.
    await emp.page.goto(ROUTES.myLeaves);
    await expect(myLeaveRow(emp.page, day).first()).toContainText(/approved/i);
    await Promise.all([emp.ctx.close(), appr.ctx.close()]);
  });

  test('approver can reject a pending leave', async ({ browser }) => {
    test.skip(!hasSession('approver'), 'No approver session — set APPROVER_USERNAME/PASSWORD in .env');
    const emp = await pageAs(browser, 'employee');
    const day = await applyLeaveOnFreeDay(emp.page, LEAVE_TYPE);
    created.push(day);
    const id = await leaveIdFromMyLeaves(emp.page, day);

    const appr = await pageAs(browser, 'approver');
    await appr.page.goto(ROUTES.approval(id));
    // "Your Comment / Feedback" <textarea> is readonly until focused (CustomTextArea
    // anti-autofill), so click it first, then fill.
    const comment = appr.page.locator('textarea[name="comment"]');
    await comment.click();
    await expect(comment).toBeEditable();
    await comment.fill('E2E: rejected by automated test');
    await appr.page.getByRole('button', { name: 'Reject Leave' }).click();
    await expect(appr.page.getByText('Leave rejected successfully!')).toBeVisible();

    await emp.page.goto(ROUTES.myLeaves);
    await expect(myLeaveRow(emp.page, day).first()).toContainText(/rejected/i);
    await Promise.all([emp.ctx.close(), appr.ctx.close()]);
  });

  // ───────────── edge cases ─────────────

  test('rejects a leave that overlaps an existing leave', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, 'employee');
    const day = await applyLeaveOnFreeDay(page, LEAVE_TYPE);
    created.push(day);

    await openApplyForm(page);
    await fillLeaveForm(page, { leaveType: LEAVE_TYPE, startDate: day, endDate: day, reason: 'E2E overlap' });
    await submit(page);

    // Backend: "Leave request conflicts with existing pending leave from X to Y"
    await expect(page.getByText(/conflicts with existing .* leave/i).first()).toBeVisible();
    await expect(page.getByText(SUCCESS_APPLY)).toHaveCount(0);
    await expect(page).toHaveURL(/\/myleaves\/create/);
    await ctx.close();
  });

  test('rejects a leave with past dates', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, 'employee');
    const day = pastWeekday(7);
    created.push(day); // safety net in case the app wrongly accepts it

    await openApplyForm(page);
    await fillLeaveForm(page, { leaveType: LEAVE_TYPE, startDate: day, endDate: day, reason: 'E2E past date' });
    await submit(page);

    // Expected behaviour: past-dated leave is refused. Backend only enforces a
    // notice period (skipped when 0) and the calendar window, so this may surface an app bug.
    await expect(page.getByText(SUCCESS_APPLY)).toHaveCount(0, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/myleaves\/create/);
    await expect(page.getByText(/past|in advance|before today|outside|not allowed|invalid/i).first()).toBeVisible();
    await ctx.close();
  });

  test('shows validation errors when required fields are missing', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, 'employee');
    await openApplyForm(page);
    await submit(page);

    // Messages appear both inline and in a toast — assert the first match.
    await expect(page.getByText('Leave type is required').first()).toBeVisible();
    await expect(page.getByText('Start date is required').first()).toBeVisible();
    await expect(page.getByText('End date is required').first()).toBeVisible();
    await expect(page).toHaveURL(/\/myleaves\/create/);
    await ctx.close();
  });

  test('rejects an end date before the start date', async ({ browser }) => {
    const { ctx, page } = await pageAs(browser, 'employee');
    const start = randomWeekday();
    const end = new Date(new Date(start).getTime() - 86_400_000).toISOString().slice(0, 10);

    await openApplyForm(page);
    await fillLeaveForm(page, { leaveType: LEAVE_TYPE, startDate: start, endDate: end, reason: 'E2E reversed dates' });
    await submit(page);

    await expect(page.getByText('End date must be after or equal to start date').first()).toBeVisible();
    await expect(page.getByText(SUCCESS_APPLY)).toHaveCount(0);
    await ctx.close();
  });
});
