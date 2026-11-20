import { test, expect } from '../helpers/fixtures';

/**
 * Smoke: every static page in the selected modules loads for the test user —
 * no redirect to login, no error/not-found screen, no 5xx from staging.
 */
const MODULES: Record<string, string[]> = {
  'People & org': [
    '/manage/employees',
    '/manage/employees/history',
    '/manage/employees/file-templates',
    '/manage/employees/import',
    '/manage/departments',
    '/manage/jobs',
    '/manage/jobs/levels',
    '/manage/organogram',
  ],
  Attendance: [
    '/manage/attendance',
    '/manage/attendance/configurations',
    '/manage/attendance/shifts',
    '/manage/attendance/timesheet',
    '/manage/attendance/web',
    '/manage/attendance/web/manage',
    '/manage/leaves/dashboard',
    '/manage/leaves/leave-types',
    '/manage/leaves/calendars',
    '/manage/leaves/consumption',
  ],
  'Payroll & advances': [
    '/manage/payroll/generated',
    '/manage/payroll/salary',
    '/manage/payroll/benefits',
    '/manage/payroll/deductions',
    '/manage/payroll/payslips',
    '/manage/payroll/payslips/manage',
    '/manage/payroll/p9',
    '/manage/payroll/wallet',
    '/manage/payroll/salary-advances',
    '/manage/payroll/salary-advance-policies',
    '/manage/salary-advances',
  ],
};

const ERROR_SCREEN = /something went wrong|application error|page not found|404|unhandled runtime error|you do not have permission|access denied/i;

for (const [module, paths] of Object.entries(MODULES)) {
  test.describe(`Smoke — ${module}`, () => {
    for (const path of paths) {
      test(`loads ${path}`, async ({ page, serverErrors }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

        await expect(page, 'redirected away (session/permission?)').toHaveURL(new RegExp(path.replace(/\//g, '\\/')));
        await expect(page.getByRole('heading', { name: ERROR_SCREEN })).toHaveCount(0);
        await expect(page.locator('main, [role="main"], body').first()).not.toHaveText(/^\s*$/);
        expect(serverErrors, `5xx responses on ${path}`).toEqual([]);
      });
    }
  });
}
