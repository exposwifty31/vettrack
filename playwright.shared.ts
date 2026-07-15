import { devices, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Shared Playwright settings for all VetTrack browser configs.
 * Suite selection (`PW_SUITE`) lives in `playwright.config.ts` only.
 */

export const DEFAULT_BASE_URL = process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3001';

export function warnIfUnsafePlaywrightBaseUrl(baseURL: string): void {
  const lower = baseURL.toLowerCase();
  if (
    lower.includes('vettrack.uk') ||
    lower.includes('vettrack-staging') ||
    lower.includes('production.railway.app')
  ) {
    console.warn(
      '[playwright] WARNING: TEST_BASE_URL looks like production or staging. ' +
        'Default Playwright is for local/CI only (127.0.0.1:3001). ' +
        'For staging E2E use: pnpm test:staging:e2e (playwright.staging.config.ts).',
    );
  }
}

/**
 * Never auto-discover — even if `testMatch` is widened by mistake.
 * Default CI uses allowlist-only `PW_SUITE=ci`; these paths stay blocked.
 */
export const PLAYWRIGHT_BASE_IGNORE = [
  'staging-*.spec.ts',
  'staging-walkthrough.spec.ts',
  'example.spec.ts',
  'signup-flow.spec.ts',
  'ui-smoke.spec.ts',
  'e2e/simulation/**',
];

/**
 * Explicit suite allowlists. Default (`ci`) is what `.github/workflows/playwright.yml` runs.
 * UI smoke uses `playwright.ui.config.ts`; staging uses `playwright.staging.config.ts`.
 */
export const PLAYWRIGHT_SUITE_MATCH: Record<string, string[]> = {
  ci: [
    'e2e/flows/**/*.spec.ts',
    'pwa.spec.ts',
    'phase-9-drills.spec.ts',
    'board-kiosk.spec.ts',
  ],
  pwa: ['pwa.spec.ts'],
  phase9: ['phase-9-drills.spec.ts'],
  board: ['board-kiosk.spec.ts'],
  signup: ['signup-flow.spec.ts'],
  workday: ['e2e/simulation/workday.spec.ts'],
  waitlist: [
    'equipment-waitlist-sse.spec.ts',
    'equipment-waitlist-paginated-list.spec.ts',
    'equipment-waitlist-two-browser.spec.ts',
  ],
  // Phase-10 III.6 dev-bypass flow walk. NOT in `ci` (self-skips without a running
  // app anyway). Must NOT be added to PLAYWRIGHT_BASE_IGNORE — testIgnore applies to
  // every suite, which would blank this one too.
  'flow-walk': ['flow-walk/web-board-walk.spec.ts'],
};

export function resolvePlaywrightSuite(): string {
  const raw = process.env.PW_SUITE?.trim() || 'ci';
  return raw in PLAYWRIGHT_SUITE_MATCH ? raw : 'ci';
}

export function sharedPlaywrightConfig(
  testMatch: string[],
): PlaywrightTestConfig {
  warnIfUnsafePlaywrightBaseUrl(DEFAULT_BASE_URL);

  return {
    testDir: './tests',
    testMatch,
    testIgnore: [...PLAYWRIGHT_BASE_IGNORE],
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    timeout: 30_000,
    globalTimeout: 12 * 60 * 1000,
    reporter: process.env.CI ? [['list'], ['html']] : 'html',
    use: {
      baseURL: DEFAULT_BASE_URL,
      trace: 'on-first-retry',
    },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
  };
}
