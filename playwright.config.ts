import { defineConfig } from '@playwright/test';
import {
  PLAYWRIGHT_SUITE_MATCH,
  resolvePlaywrightSuite,
  sharedPlaywrightConfig,
} from './playwright.shared.js';

/**
 * Default Playwright config — local API + CI only (`.github/workflows/playwright.yml`).
 *
 * Discovery is allowlist-only via PW_SUITE (default ci):
 *   - tests/e2e/flows/ (read-only API/auth flow specs)
 *   - `tests/pwa.spec.ts` — PWA audit (P01–P20)
 *   - `tests/phase-9-drills.spec.ts` — Phase 9 browser drills
 *
 * Also listed in `PLAYWRIGHT_BASE_IGNORE` (defense in depth).
 *
 * Never discovered by default:
 *   - `tests/staging-*.spec.ts`, `tests/staging-walkthrough.spec.ts` → `playwright.staging.config.ts` + `pnpm test:staging:e2e` / `test:staging:walkthrough`
 *   - `tests/example.spec.ts` → upstream template (not VetTrack)
 *   - `tests/signup-flow.spec.ts` → `pnpm test:playwright:signup`
 *   - `tests/ui-smoke.spec.ts` → `pnpm test:playwright:ui-smoke` (`playwright.ui.config.ts`)
 *   - `tests/e2e/simulation/workday.spec.ts` → `PW_SUITE=workday` / nightly workflow
 *
 * Do NOT point TEST_BASE_URL at production (`vettrack.uk`) or staging
 * (`vettrack-staging.up.railway.app`). Use http://127.0.0.1:3001 with PLAYWRIGHT_E2E=true.
 */

const suite = resolvePlaywrightSuite();
const testMatch = PLAYWRIGHT_SUITE_MATCH[suite];

export default defineConfig(sharedPlaywrightConfig(testMatch));
