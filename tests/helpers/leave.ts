import { expect, type Locator, type Page } from '@playwright/test';

export const ROUTES = {
  myLeaves: '/manage/myleaves',
  applyLeave: '/manage/myleaves/create',
  pendingApproval: '/manage/leaves/pending-approval',
  approval: (id: string) => `/manage/leaves/${id}/approval`,
};

export const SUCCESS_APPLY = 'Leave applied for successfully';

// ───────────── dates ─────────────

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

function today(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

/** Days ahead of today the generated leave starts (covers typical notice periods). */
const LEAD_DAYS = 14;
/** How far past the start the random pick may land. */
const SPREAD_DAYS = 60;

/**
 * A random future weekday, computed from today's date — no configuration needed.
 * Window: today+14 .. today+74, kept inside a single calendar year (leave
 * calendars are usually per year): if the window would cross 31 Dec it is cut
 * there, and if fewer than 5 days remain this year it moves to early next year.
 */
export function randomWeekday(): string {
  let start = addDays(today(), LEAD_DAYS);
  let end = addDays(start, SPREAD_DAYS);
  const yearEnd = new Date(Date.UTC(start.getUTCFullYear(), 11, 31));
  if (end > yearEnd) {
    const daysLeft = Math.floor((yearEnd.getTime() - start.getTime()) / 86_400_000);
    if (daysLeft >= 5) {
      end = yearEnd;
    } else {
      start = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 5));
      end = addDays(start, SPREAD_DAYS);
    }
  }
  const span = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  for (let i = 0; i < 50; i++) {
    const d = addDays(start, Math.floor(Math.random() * (span + 1)));
    if (isWeekday(d)) return iso(d);
  }
  throw new Error(`Could not find a weekday between ${iso(start)} and ${iso(end)}`);
}

/** A weekday at least `daysAgo` days in the past. */
export function pastWeekday(daysAgo = 7): string {
  let d = addDays(today(), -daysAgo);
  while (!isWeekday(d)) d = addDays(d, -1);
  return iso(d);
}

/** Matches formatDateForDisplay(): "Monday, March 1, 2027" (Africa/Nairobi). */
export function displayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00+03:00`).toLocaleDateString('en-US', {
    timeZone: 'Africa/Nairobi', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ───────────── form ─────────────

/**
 * CustomInput renders <label> and <input> as siblings with no htmlFor/id, so
 * getByLabel() does not work. Anchor on the label text instead.
 */
function inputByLabel(page: Page, label: string): Locator {
  return page.locator('label', { hasText: new RegExp(`^\\s*${label}`) })
    .first()
    .locator('xpath=following-sibling::div[1]//input');
}

export interface LeaveInput {
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
}

export async function openApplyForm(page: Page) {
  await page.goto(ROUTES.applyLeave);
  await expect(page.getByText('Please fill in all required information for your leave request')).toBeVisible();
}

export async function fillLeaveForm(page: Page, input: LeaveInput) {
  if (input.leaveType) {
    const field = page.locator('div', { has: page.locator('label', { hasText: /^\s*Leave Type/ }) }).last();
    await field.getByRole('combobox').click();
    const option = page.getByRole('option', { name: input.leaveType, exact: false }).first();
    if (!(await option.isVisible({ timeout: 10_000 }).catch(() => false))) {
      const available = (await page.getByRole('option').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
      throw new Error(`Leave type "${input.leaveType}" is not available to this employee. ` +
        `Available: ${available.join(', ') || '(none)'}. Update LEAVE_TYPE / ZERO_BALANCE_LEAVE_TYPE in .env.`);
    }
    await option.click();
  }
  if (input.startDate) await inputByLabel(page, 'Start Date').fill(input.startDate);
  if (input.endDate) await inputByLabel(page, 'End Date').fill(input.endDate);
  if (input.reason) {
    const editor = page.locator('.ck-editor__editable[contenteditable="true"]').first();
    await editor.click();
    await editor.pressSequentially(input.reason);
  }
  // Let the backend validity check (/leaves/stats) settle.
  await expect(submitButton(page)).toHaveText(/Apply for Leave/, { timeout: 20_000 });
}

export function submitButton(page: Page): Locator {
  return page.locator('form').getByRole('button', { name: /Apply for Leave|Validating|Processing/ });
}

export async function submit(page: Page) {
  await submitButton(page).click();
}

export async function applyLeave(page: Page, input: Required<Pick<LeaveInput, 'leaveType' | 'startDate' | 'endDate'>> & LeaveInput) {
  await openApplyForm(page);
  await fillLeaveForm(page, { reason: `E2E leave test ${Date.now()}`, ...input });
  await submit(page);
  await expect(page.getByText(SUCCESS_APPLY)).toBeVisible();
  await page.waitForURL(/\/manage\/myleaves\/?(\?|$)/);
}

// Leave types found to have no balance left during this run (shared across tests in the worker).
const exhausted = new Set<string>();
let knownTypes: string[] = [];

/** The preferred leave type, or the first other type that still has balance this run. */
export function usableLeaveType(preferred: string): string {
  if (!exhausted.has(preferred)) return preferred;
  const next = knownTypes.find((t) => !exhausted.has(t));
  if (!next) throw new Error(noBalanceMessage());
  return next;
}

function noBalanceMessage() {
  return `No leave balance left on any leave type for this employee (exhausted: ${[...exhausted].join(', ')}). ` +
    'Each approve-test run uses up one real leave day: ask HR to top up the test account\'s balance on staging, ' +
    'or set LEAVE_TYPE in .env to a type that still has days.';
}

async function readLeaveTypes(page: Page) {
  if (knownTypes.length) return;
  await openApplyForm(page);
  const field = page.locator('div', { has: page.locator('label', { hasText: /^\s*Leave Type/ }) }).last();
  await field.getByRole('combobox').click();
  await expect(page.getByRole('option').first()).toBeVisible();
  knownTypes = (await page.getByRole('option').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  await page.keyboard.press('Escape');
}

/**
 * Applies a one-day leave on a random free weekday and returns the date used.
 * - On an overlap conflict (existing leave that day), tries another date.
 * - On "Insufficient ... balance", marks that type exhausted and falls back to another
 *   leave type that still has days (see usableLeaveType()).
 */
export async function applyLeaveOnFreeDay(page: Page, preferredType: string, attempts = 8): Promise<string> {
  await readLeaveTypes(page);
  const tried = new Set<string>();
  for (let i = 0; i < attempts; i++) {
    const leaveType = usableLeaveType(preferredType);
    let day = randomWeekday();
    for (let j = 0; j < 20 && tried.has(day); j++) day = randomWeekday();
    tried.add(day);

    await openApplyForm(page);
    await fillLeaveForm(page, { leaveType, startDate: day, endDate: day, reason: `E2E leave test ${Date.now()}` });
    const insufficient = page.getByText(/Insufficient .*balance/i).first();
    if (await insufficient.isVisible().catch(() => false)) { exhausted.add(leaveType); continue; }
    await submit(page);

    const success = page.getByText(SUCCESS_APPLY);
    const conflict = page.getByText(/conflicts with existing .* leave/i).first();
    await expect(success.or(conflict).or(insufficient).first()).toBeVisible();
    if (await success.isVisible()) {
      await page.waitForURL(/\/manage\/myleaves\/?(\?|$)/);
      return day;
    }
    if (await insufficient.isVisible().catch(() => false)) exhausted.add(leaveType);
  }
  throw new Error(`Could not apply for leave after ${attempts} attempts (dates tried: ${[...tried].join(', ')}; ` +
    `exhausted types: ${[...exhausted].join(', ') || 'none'}). Delete old pending E2E leaves or top up balance on staging.`);
}

// ───────────── my leaves table ─────────────

export function myLeaveRow(page: Page, startDate: string): Locator {
  return page.getByRole('row').filter({ hasText: displayDate(startDate) });
}

/** Opens the row's action menu and returns the leave UUID from the "View Details" link. */
export async function leaveIdFromMyLeaves(page: Page, startDate: string): Promise<string> {
  await page.goto(ROUTES.myLeaves);
  const row = myLeaveRow(page, startDate).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open menu' }).click();
  // DropdownMenuItem asChild + <Link> → the menuitem element is the <a> itself.
  const href = await page.getByRole('menuitem', { name: 'View Details' }).getAttribute('href');
  await page.keyboard.press('Escape');
  const id = href?.match(/[0-9a-f-]{36}/i)?.[0];
  if (!id) throw new Error(`Could not extract leave id from href=${href}`);
  return id;
}

/** Best-effort cleanup: delete a PENDING leave from My Leaves. Never throws. */
export async function deleteMyLeave(page: Page, startDate: string) {
  try {
    await page.goto(ROUTES.myLeaves);
    const row = myLeaveRow(page, startDate).first();
    if (!(await row.isVisible({ timeout: 10_000 }).catch(() => false))) return;
    await row.getByRole('button', { name: 'Open menu' }).click();
    const del = page.getByRole('menuitem', { name: /Delete Leave/ });
    if (!(await del.isVisible().catch(() => false))) { await page.keyboard.press('Escape'); return; }
    await del.click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button').filter({ hasNotText: /^Cancel$/ }).last().click();
    await expect(page.getByText('Leave application deleted successfully!')).toBeVisible();
  } catch {
    /* cleanup is best-effort */
  }
}
