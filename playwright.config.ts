import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

const BASE_URL = process.env.STAGING_BASE_URL ?? 'https://hr-app-frontend-staging.staging.kiotapay.com';
const AUTH_URL = process.env.STAGING_AUTH_URL ?? 'https://auth-app-ui-staging.staging.kiotapay.com';

// Hard guard: never run against production.
for (const [name, url] of Object.entries({ STAGING_BASE_URL: BASE_URL, STAGING_AUTH_URL: AUTH_URL })) {
  if (!/staging/i.test(new URL(url).hostname)) {
    throw new Error(`${name} must point at a staging host (got ${new URL(url).hostname}). Refusing to run.`);
  }
}

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Leave tests share staging accounts and date ranges — keep them serial.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
