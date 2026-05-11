import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.{ts,js}'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Per-test timeout — made explicit. Matches the previous implicit default. */
  timeout: 30_000,
  /* Suite-wide safety net so future regressions fail fast with a clean
     GlobalTimeoutError instead of grinding against the GitHub Actions
     `timeout-minutes: 60` job cap and looking like a hang. With workers:1
     and 62 tests × 30s × 3 retries the worst-case is ~93 min, so a 12-min
     ceiling is loose enough for healthy runs and aggressive enough to
     surface real regressions quickly. */
  globalTimeout: 12 * 60 * 1000,
  /* Reporter — in CI we want streaming progress (the previous html-only
     reporter buffered to disk, which is why the recent run looked frozen
     in the Actions UI). Locally keep the rich html report. */
  reporter: process.env.CI ? [['list'], ['html']] : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL used by relative `page.goto("/...")` and `request.get("/...")`.
       CI exports TEST_BASE_URL=http://127.0.0.1:3001 (production-like build
       served by Express); locally it falls back to the same value. Setting
       baseURL globally is the canonical Playwright fix — individual specs
       should NOT prepend BASE_URL themselves. */
    baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3001',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
