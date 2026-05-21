# Playwright test matrix

VetTrack uses **allowlist-only** discovery in `playwright.config.ts` (`PW_SUITE`, default `ci`). `PLAYWRIGHT_BASE_IGNORE` in `playwright.shared.ts` blocks signup, UI smoke, staging, example, and simulation paths even if `testMatch` is misconfigured. Staging specs, the upstream `example` template, signup, UI smoke, and workday simulation are **never** picked up unless you run the explicit script or set `PW_SUITE`.

| Config / script | `testDir` | Discovery | `baseURL` | When to run |
|-----------------|-----------|-----------|-----------|-------------|
| `playwright.config.ts` (`PW_SUITE=ci`, default) | `tests/` | `e2e/flows/**`, `pwa.spec.ts`, `phase-9-drills.spec.ts` | `TEST_BASE_URL` → `http://127.0.0.1:3001` | **CI** (`playwright.yml`: PRs into `main`/`master`/`staging` + push to those branches), local safe E2E |
| `pnpm test:playwright:ci` | same | CI allowlist | `:3001` + `PLAYWRIGHT_E2E=true` | Same as default chromium CI job |
| `pnpm test:playwright:pwa` | same | `pwa.spec.ts` only | `:3001` | PWA audit only |
| `pnpm test:playwright:phase9` | same | `phase-9-drills.spec.ts` only | `:3001` | Phase 9 drills only |
| `pnpm test:playwright:signup` | same | `signup-flow.spec.ts` only | `:3001` / optional `:5000` | Clerk + DB mutations — **not** default CI |
| `pnpm test:playwright:ui-smoke` | `playwright.ui.config.ts` | `ui-smoke.spec.ts` | `:5000` or HTTPS | Manual UI audit; needs Clerk session for full auth routes |
| `playwright.staging.config.ts` | staging specs | `staging-*.spec.ts` | Staging Railway | **`staging` branch** + `pnpm test:staging:e2e` / manual workflow |
| `PW_SUITE=workday` | same | `e2e/simulation/workday.spec.ts` | Staging URL + `STAGING_E2E_CONFIRM=yes` | Nightly `workday-simulation-nightly.yml` only |

## Default CI scope (`pnpm test:playwright:ci`)

| Spec | Tests (chromium) | Notes |
|------|------------------|-------|
| `tests/e2e/flows/api-health.spec.ts` | 2 | Read-only health/version |
| `tests/e2e/flows/auth-gates.spec.ts` | 4 | Dev-bypass RBAC |
| `tests/e2e/flows/equipment-read.spec.ts` | 2 | Read-only equipment |
| `tests/pwa.spec.ts` | 20 | P01–P20 PWA audit |
| `tests/phase-9-drills.spec.ts` | 9 | Phase 9 browser drills |

**Total:** 37 chromium tests (3 files under `e2e/flows/` count as one group).

## Explicit-only (not in default CI)

| Spec / area | Script | Reason |
|-------------|--------|--------|
| `tests/example.spec.ts` | — (ignored) | Upstream Playwright template; hits `playwright.dev` |
| `tests/signup-flow.spec.ts` | `pnpm test:playwright:signup` | Creates/deletes Clerk + `vt_users` |
| `tests/ui-smoke.spec.ts` | `pnpm test:playwright:ui-smoke` | Route screenshots; separate UI config |
| `tests/staging-*.spec.ts`, `staging-walkthrough.spec.ts` | `pnpm test:staging:e2e`, `test:staging:walkthrough` | Mutates staging |
| `tests/e2e/simulation/workday.spec.ts` | `PW_SUITE=workday` (nightly) | Staging-only compressed day |

## Commands

```bash
# List default CI discovery
pnpm exec playwright test --project=chromium --list

# CI-equivalent local run (API on :3001, seed, PLAYWRIGHT_E2E=true)
pnpm test:playwright:ci

# Optional suites
pnpm test:playwright:pwa
pnpm test:playwright:phase9
pnpm test:playwright:signup
pnpm test:playwright:ui-smoke

# Safe aggregate (vitest + optional Playwright when PLAYWRIGHT_E2E=1)
./scripts/run-safe-tests.sh
```

See `TEST_AUDIT.md` and `scripts/run-safe-tests.sh`.
