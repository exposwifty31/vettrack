import { defineConfig, devices } from "@playwright/test";

/**
 * Staging-only Playwright config — the ONLY config that runs `tests/staging-*.spec.ts`.
 *
 * Never use the default `playwright.config.ts` against staging or production URLs.
 *
 *   TEST_BASE_URL=https://vettrack-staging.up.railway.app
 *   STAGING_E2E_PASSWORD=...
 *   CLERK_SECRET_KEY=sk_test_...
 *   pnpm staging:seed && pnpm test:staging:e2e && pnpm staging:cleanup
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: ["staging-*.spec.ts"],
  testIgnore: ["**/example.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  globalTimeout: 20 * 60 * 1000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/staging-walkthrough/playwright-report" }],
  ],
  outputDir: "artifacts/staging-walkthrough/test-results",
  globalSetup: "./tests/staging/global-setup.ts",
  globalTeardown: "./tests/staging/global-teardown.ts",
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "https://vettrack-staging.up.railway.app",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "staging-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
