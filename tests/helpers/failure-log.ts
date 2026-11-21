import { test, type Page, type TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Human-readable failure/attempt log.
 * - printed to the console (shows in the `list` reporter output),
 * - appended to test-results/failure-reasons.log (one file per run; Playwright clears test-results on start),
 * - attached to the test in the HTML report.
 */
const LOG_FILE = path.join(__dirname, '..', '..', 'test-results', 'failure-reasons.log');

export function logReason(line: string, info: TestInfo | undefined = currentInfo()) {
  const who = info ? `${info.titlePath.slice(1).join(' › ')}` : 'setup';
  const stamped = `[${new Date().toISOString()}] ${who}\n    ${line.replace(/\n/g, '\n    ')}`;
  console.log(`  ↳ ${line}`);
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, stamped + '\n');
  } catch { /* logging must never break a test */ }
}

function currentInfo(): TestInfo | undefined {
  try { return test.info(); } catch { return undefined; }
}

/** Selectors for anything the app uses to tell the user what went wrong. */
const FEEDBACK = [
  '[role="alert"]',
  '[data-sonner-toast]',
  '[id$="-form-item-message"]',
  '.text-destructive',
  '.text-red-500',
  '.text-red-600',
].join(', ');

/** Message wording the app uses for errors/results, matched anywhere on the page. */
const MESSAGE_TEXT = /conflicts with existing|insufficient|balance|is required|must be|must have|not allowed|in advance|invalid|failed|error|successfully|notice period|probation|exceed/i;

/** Visible feedback messages on the page right now (inline errors, toasts, alerts, known wording), de-duplicated. */
export async function pageFeedback(page: Page): Promise<string[]> {
  if (page.isClosed()) return [];
  const fromSelectors = await page.locator(FEEDBACK).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed')
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
  ).catch(() => [] as string[]);
  const fromText = await page.getByText(MESSAGE_TEXT).evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed')
      .filter((e) => !['SCRIPT', 'STYLE', 'OPTION', 'LABEL', 'BUTTON'].includes(e.tagName))
      .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
  ).catch(() => [] as string[]);
  const texts = [...fromSelectors, ...fromText]
    .filter((t) => (t.match(/[a-z]/gi)?.length ?? 0) >= 4 && t.length < 300) // drops "*" required markers
    .filter((t) => !/^Approval Flow/i.test(t));
  // Keep the shortest distinct messages (a container's text includes its children's).
  const uniq = [...new Set(texts)].sort((a, b) => a.length - b.length);
  return uniq.filter((t, i) => !uniq.slice(0, i).some((shorter) => t.includes(shorter) && t !== shorter && t.length > shorter.length * 2));
}

export type Outcome = 'success' | 'conflict' | 'balance' | 'validation' | 'no-message';

/** Classifies what the leave form showed after an attempt. */
export function classify(messages: string[], success = false): Outcome {
  if (success) return 'success';
  const all = messages.join(' | ');
  if (/conflicts with existing/i.test(all)) return 'conflict';
  if (/insufficient .*balance|available: 0/i.test(all)) return 'balance';
  if (all) return 'validation';
  return 'no-message';
}

/**
 * Call from afterEach: when the test failed, log what each still-open page was
 * showing (URL + feedback messages) so the failure explains itself.
 */
export async function logFailureContext(pages: Page[], info: TestInfo) {
  if (info.status === info.expectedStatus) return;
  const lines: string[] = [`FAILED (${info.status}): ${(info.error?.message ?? '').split('\n')[0]}`];
  for (const p of pages) {
    if (p.isClosed()) continue;
    const msgs = await pageFeedback(p);
    lines.push(`page ${p.url()}`);
    lines.push(`  app showed: ${msgs.length ? msgs.join(' | ') : '(no visible error/toast message)'}`);
  }
  const text = lines.join('\n');
  logReason(text, info);
  await info.attach('failure-reason', { body: text, contentType: 'text/plain' });
}
