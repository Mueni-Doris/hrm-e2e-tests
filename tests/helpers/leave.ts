import { expect, test, type Locator, type Page } from '@playwright/test';
import { classify, logReason, pageFeedback, type Outcome } from './failure-log';

export const ROUTES = {
  myLeaves: '/manage/myleaves',
  /** All leaves on one page (the table pages 10 at a time; older test leaves end up on page 2+). */
  myLeavesAll: '/manage/myleaves?size=500',
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
    if (!(await expect(option).toBeVisible({ timeout: 15_000 }).then(() => true, () => false))) {
      const available = (await page.getByRole('option').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
      throw new Error(`Leave type "${input.leaveType}" is not available to this employee. ` +
        `Available: ${available.join(', ') || '(none)'}. Update LEAVE_TYPE in .env.`);
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

export interface Attempt { n: number; date: string; leaveType: string; outcome: Outcome; message: string }

function describeAttempts(attempts: Attempt[]) {
  return attempts.map((a) => `  #${a.n} ${a.date} [${a.leaveType}] → ${a.outcome.toUpperCase()}: ${a.message}`).join('\n');
}

/** Headline for the error, naming the dominant reason (conflict vs balance vs other). */
function headline(attempts: Attempt[]) {
  const count = (o: Outcome) => attempts.filter((a) => a.outcome === o).length;
  const c = count('conflict'), b = count('balance'), v = count('validation'), n = count('no-message');
  const parts = [c && `${c} date conflict(s)`, b && `${b} no-balance`, v && `${v} validation error(s)`, n && `${n} with no message`]
    .filter(Boolean).join(', ');
  let why: string;
  if (c === attempts.length) why = 'CONFLICT: every date tried already has a leave. Delete old pending E2E leaves on staging (My Leaves).';
  else if (b && !knownTypes.some((t) => !exhausted.has(t))) why = 'BALANCE: ' + noBalanceMessage();
  else if (c && c >= b) why = 'Mostly CONFLICT: dates already taken by existing leaves.';
  else if (b) why = 'Mostly BALANCE: leave types are out of days.';
  else if (v) why = 'VALIDATION: the app rejected the form — see the messages per attempt below.';
  else why = 'NO MESSAGE: the app neither confirmed nor showed an error — check the trace/screenshot.';
  return `Could not apply for leave after ${attempts.length} attempts (${parts}).\n${why}`;
}

/**
 * Applies a one-day leave on a random free weekday and returns the date used.
 * Every attempt is recorded with its outcome and the exact app message:
 * - conflict (existing leave that day)  → try another date
 * - balance ("Insufficient ... balance") → mark the type exhausted, fall back to another type
 * - validation / no-message             → retry; reported if all attempts fail
 * Attempts are logged (console + test-results/failure-reasons.log + HTML report attachment).
 */
export async function applyLeaveOnFreeDay(page: Page, preferredType: string, maxAttempts = 8): Promise<string> {
  await readLeaveTypes(page);
  const tried = new Set<string>();
  const attempts: Attempt[] = [];
  const record = async (a: Attempt) => {
    attempts.push(a);
    logReason(`leave attempt #${a.n} ${a.date} [${a.leaveType}] → ${a.outcome.toUpperCase()}${a.message ? `: ${a.message}` : ''}`);
  };

  let cleanups = 0;
  const MAX_CLEANUPS = 10;
  try {
    for (let i = 1; i <= maxAttempts; i++) {
      let leaveType: string;
      try { leaveType = usableLeaveType(preferredType); } catch { break; } // every type exhausted
      let day = randomWeekday();
      for (let j = 0; j < 20 && tried.has(day); j++) day = randomWeekday();
      tried.add(day);

      await openApplyForm(page);
      await fillLeaveForm(page, { leaveType, startDate: day, endDate: day, reason: `E2E leave test ${Date.now()}` });

      // The form validates live (balance/conflict) before submit.
      let msgs = await pageFeedback(page);
      let outcome = classify(msgs);
      if (outcome !== 'conflict' && outcome !== 'balance') {
        await submit(page);
        const success = page.getByText(SUCCESS_APPLY);
        const listUrl = /\/manage\/myleaves\/?(\?|$)/;
        // Staging can take 30s+ to answer: wait until the request finishes (button leaves
        // "Validating/Processing", the success toast shows, or we land on My Leaves) before judging.
        const settled = await expect.poll(async () =>
            listUrl.test(page.url())
            || (await success.isVisible().catch(() => false))
            || !/Validating|Processing|Loading/i.test(await submitButton(page).innerText().catch(() => '')),
          { timeout: 60_000, intervals: [500, 1000, 2000] }).toBe(true).then(() => true, () => false);
        if (!settled) {
          await record({ n: i, date: day, leaveType, outcome: 'no-message', message: 'submit still "Processing" after 60s (staging did not answer)' });
          continue;
        }
        if (listUrl.test(page.url()) || (await success.isVisible().catch(() => false))) {
          await page.waitForURL(/\/manage\/myleaves\/?(\?|$)/);
          await record({ n: i, date: day, leaveType, outcome: 'success', message: SUCCESS_APPLY });
          return day;
        }
        msgs = await pageFeedback(page);
        outcome = classify(msgs);
      }
      const relevant = msgs.filter((m) => !/Approval Flow/i.test(m));
      await record({ n: i, date: day, leaveType, outcome, message: relevant.join(' | ') || '(app showed no message)' });
      if (outcome === 'balance') exhausted.add(leaveType);
      if (outcome === 'conflict' && cleanups < MAX_CLEANUPS) {
        cleanups++;
        if (await deleteLeftoverE2ELeave(page, day)) tried.delete(day); // the date is free again
      }
    }
  } finally {
    if (attempts.length) {
      await test.info().attach('leave-attempts', { body: describeAttempts(attempts), contentType: 'text/plain' }).catch(() => {});
    }
  }
  throw new Error(`${headline(attempts)}\nAttempts:\n${describeAttempts(attempts) || '  (none — no usable leave type)'}`);
}

/**
 * Asserts the form shows `expected`; if not, the error says what the app showed instead
 * (e.g. a balance error where a conflict was expected).
 */
export async function expectFormMessage(page: Page, expected: RegExp | string, what: string) {
  const loc = typeof expected === 'string' ? page.getByText(expected).first() : page.getByText(expected).first();
  try {
    await expect(loc).toBeVisible();
    logReason(`${what}: app showed the expected message (${expected})`);
  } catch {
    const msgs = await pageFeedback(page);
    const shown = msgs.join(' | ') || '(no visible message)';
    const reason = classify(msgs);
    logReason(`${what}: expected ${expected} but app showed [${reason.toUpperCase()}] ${shown}`);
    throw new Error(`${what}: expected message ${expected} was not shown.\n` +
      `App showed instead (${reason.toUpperCase()}): ${shown}\nURL: ${page.url()}`);
  }
}

// ───────────── my leaves table ─────────────

export function myLeaveRow(page: Page, startDate: string, status?: 'PENDING'): Locator {
  const rows = page.getByRole('row').filter({ hasText: displayDate(startDate) });
  // A date can also have REJECTED rows from earlier runs; cleanup must target the PENDING one.
  return status ? rows.filter({ hasText: status }) : rows;
}

/** Opens the row's action menu and returns the leave UUID from the "View Details" link. */
export async function leaveIdFromMyLeaves(page: Page, startDate: string, status?: 'PENDING'): Promise<string> {
  await page.goto(ROUTES.myLeavesAll);
  const row = myLeaveRow(page, startDate, status).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open menu' }).click();
  // DropdownMenuItem asChild + <Link> → the menuitem element is the <a> itself.
  const href = await page.getByRole('menuitem', { name: 'View Details' }).getAttribute('href');
  await page.keyboard.press('Escape');
  const id = href?.match(/[0-9a-f-]{36}/i)?.[0];
  if (!id) throw new Error(`Could not extract leave id from href=${href}`);
  return id;
}

/**
 * Deletes the PENDING leave on `startDate` only if a test created it (its reason contains "E2E").
 * Leftovers come from runs that were cancelled or whose submit answered after the test moved on;
 * without this they block every date in the window ("conflicts with existing pending leave").
 * Real leaves (no "E2E" in the reason) are never touched. Returns true when one was deleted.
 */
export async function deleteLeftoverE2ELeave(page: Page, startDate: string): Promise<boolean> {
  try {
    const id = await leaveIdFromMyLeaves(page, startDate, 'PENDING');
    await page.goto(`${ROUTES.myLeaves}/${id}`);
    // The details page loads the form, then fills the reason editor; give slow staging time.
    const isE2E = await expect(page.getByText(/\bE2E\b/).first()).toBeVisible({ timeout: 20_000 }).then(() => true, () => false);
    if (!isE2E) {
      logReason(`pending leave on ${startDate} is not a test leave (no "E2E" in reason): left alone`);
      return false;
    }
    await page.goto(ROUTES.myLeavesAll);
    const pendingRows = myLeaveRow(page, startDate, 'PENDING');
    await expect(pendingRows.first()).toBeVisible({ timeout: 30_000 });
    const before = await pendingRows.count();
    await deleteMyLeave(page, startDate);
    await page.goto(ROUTES.myLeavesAll);
    await expect(page.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });
    const after = await pendingRows.count();
    logReason(`deleted leftover E2E pending leave on ${startDate} (pending rows ${before} → ${after})`);
    return after === 0;
  } catch (e) {
    logReason(`could not clean up leftover leave on ${startDate}: ${(e as Error).message.split('\n')[0]}`);
    return false;
  }
}

/** Best-effort cleanup: delete a PENDING leave from My Leaves. Never throws. */
export async function deleteMyLeave(page: Page, startDate: string) {
  try {
    await page.goto(ROUTES.myLeavesAll);
    const row = myLeaveRow(page, startDate, 'PENDING').first();
    // isVisible() does not wait; staging can take 20s+ to list leaves.
    if (!(await expect(row).toBeVisible({ timeout: 30_000 }).then(() => true, () => false))) return;
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
