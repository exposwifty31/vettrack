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
    lower.includes('production.railway.app')
  ) {
    console.warn(
      '[playwright] WARNING: TEST_BASE_URL looks like production. ' +
        'Default Playwright is for local/CI only (127.0.0.1:3001).',
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
  'signup-flow.spec.ts',
  'ui-smoke.spec.ts',
  'e2e/simulation/**',
];

/**
 * Explicit suite allowlists. Default (`ci`) is what `.github/workflows/playwright.yml` runs.
 * UI smoke uses `playwright.ui.config.ts`.
 */
export const PLAYWRIGHT_SUITE_MATCH: Record<string, string[]> = {
  ci: [
    'e2e/flows/**/*.spec.ts',
    'pwa.spec.ts',
    'phase-9-drills.spec.ts',
    'board-kiosk.spec.ts',
    'board-states.spec.ts',
  ],
  pwa: ['pwa.spec.ts'],
  phase9: ['phase-9-drills.spec.ts'],
  board: ['board-kiosk.spec.ts', 'board-states.spec.ts'],
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
    // CI ran single-worker on a 4-vCPU runner, so the suite was serialized for no
    // reason: the mutating specs each create uniquely-suffixed fixtures and delete
    // them in a `finally`, so they do not contend. `50%` (2 workers on the standard
    // runner) leaves headroom for the API server + Postgres sharing the box.
    // Override with PW_WORKERS if a shard ever proves contended.
    workers: process.env.PW_WORKERS || (process.env.CI ? '50%' : undefined),
    timeout: 30_000,
    globalTimeout: 12 * 60 * 1000,
    // `list` gives readable step output; `html` still WRITES `playwright-report/` on
    // every CI run — `open: 'never'` only suppresses the viewer, it does not skip
    // generation. Kept deliberately: the workflow uploads that directory `if: failure()`
    // (.github/workflows/playwright.yml), and a trace-linked HTML report is what makes a
    // red shard diagnosable. `blob` would be cheaper but needs a `merge-reports` step to
    // become readable, which trades a cost paid on green runs for friction paid on red
    // ones — the wrong way round. Shards are reported independently, so nothing is merged.
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
    // Visual-regression baselines are platform-specific (font rendering) and
    // the repo had none before board-states.spec.ts. `toHaveScreenshot`
    // comparisons therefore run only when PW_VISUAL=1 is set — functional
    // assertions always run; pixels compare only where baselines exist
    // (generate with: PW_VISUAL=1 pnpm exec playwright test --update-snapshots).
    ignoreSnapshots: process.env.PW_VISUAL !== '1',
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
