# VetTrack — Test Inventory & Execution Audit

**Generated:** 2026-05-21  
**Section:** A — Test Inventory & Execution Audit (audit only; no test/config/workflow edits)  
**Branch audited:** `staging` (includes `playwright.staging.config.ts`, `scripts/staging/*`, `tests/e2e/flows/`)  
**Constraint:** No existing test files were modified.

---

## Validation snapshot (required commands)

| Command | Result | Notes |
|---------|--------|-------|
| `npx tsc --noEmit` | ✅ Pass | Frontend project |
| `npx tsc --noEmit --project tsconfig.server-check.json` | ✅ Pass | Server check project |
| `pnpm test` | ✅ Pass | 236 files / 3402 tests passed; 3 files skipped |
| `pnpm exec vitest --run` | ✅ Pass | Same as `pnpm test` |
| `pnpm exec playwright test --list` | ✅ Pass | 213 listed (71 × chromium project) |

**Safe local runner:** `./scripts/run-safe-tests.sh`  
**Safe Playwright (API required):** `PLAYWRIGHT_E2E=1 ./scripts/run-safe-tests.sh` (allowlist: `pwa`, `phase-9-drills`, `tests/e2e/flows/`)

Staging suites were **not executed** (no `*_STAGING` secrets in this environment).

---

## Test surface map

| Category | Repo reality | Location |
|----------|--------------|----------|
| Unit / integration | Vitest (`environment: node`) | `tests/**/*.test.{ts,js}`, `server/tests/*.test.ts` |
| API / integration (DB) | Vitest + `DATABASE_URL` | Subset of vitest; some excluded by default |
| API / integration (live server) | Vitest hitting `:3001` | Excluded in `vite.config.ts` |
| Playwright CI | `playwright.config.ts` → `127.0.0.1:3001` | `.github/workflows/playwright.yml` |
| Playwright UI smoke | `playwright.ui.config.ts` | `tests/ui-smoke.spec.ts` |
| Staging Playwright | `playwright.staging.config.ts` | `tests/staging-*.spec.ts` |
| Staging walkthrough | `tests/staging-walkthrough.spec.ts` | Staging manual workflow |
| Phase 9 drills | Browser + metrics API | `tests/phase-9-drills.spec.ts` |
| Signup lifecycle | Clerk + `vt_users` | `tests/signup-flow.spec.ts` |
| PWA | Playwright + SW | `tests/pwa.spec.ts` |
| E2E flows | Browser + API | `tests/e2e/flows/*.spec.ts` |
| Smoke / health | `GET /api/healthz`, startup | Vitest + Playwright |
| GitHub workflows | CI, Playwright, Release Gate, Flake, Staging manual | `.github/workflows/*.yml` |
| k6 / load | — | **Not present** in repo |
| `scripts/staging/*` | Seed / cleanup / guard | Staging mutation tooling |

---

## Config & workflow inventory

| File | Suite | Runtime | Command | Status | Environment | Blockers | Fix needed |
|------|-------|---------|---------|--------|-------------|----------|------------|
| `vite.config.ts` `test.*` | Vitest default | Node | `pnpm test` | ✅ Runnable now | Local CI-style; optional Postgres for DB-heavy tests | None observed | — |
| `playwright.config.ts` | Playwright default | Chromium/Firefox/WebKit | `pnpm exec playwright test --project=chromium` | ⚠️ Runnable with setup | Local CI-style; API on `:3001`, `PLAYWRIGHT_E2E=true`, seed | Includes template + Clerk + UI smoke specs in **list**; CI runs full match | Exclude `example`, `signup-flow`, `ui-smoke` from CI allowlist |
| `playwright.ui.config.ts` | UI smoke | Chromium | `pnpm exec playwright test --config=playwright.ui.config.ts` | ⚠️ Runnable with setup | Local `:5000` or remote HTTPS; Clerk session file | Clerk credentials / bot protection on prod | Never aim at `vettrack.uk` in automation |
| `playwright.staging.config.ts` | Staging E2E | Chromium | `pnpm test:staging:e2e` | ⚠️ Runnable with setup | Staging Railway + `*_STAGING` secrets | Manual workflow + local only | **Never** in safe runner |
| `.github/workflows/ci.yml` | Typecheck + Vitest + build | GHA | PR/push `main` | ✅ Runnable now | Postgres service | — | — |
| `.github/workflows/playwright.yml` | Playwright E2E | GHA | push/PR `main` | ⚠️ Runnable with setup | Postgres + built frontend + API | Runs all `*.spec` under `tests/` | Narrow to safe allowlist |
| `.github/workflows/release-gate.yml` | Multi-gate Vitest subsets | GHA | push `main` | ✅ Runnable now | Postgres for DB gates | Duplicates much of `ci.yml` | Consider consolidating |
| `.github/workflows/flake-detection.yml` | Vitest × N | GHA cron | schedule / dispatch | ✅ Runnable now | Postgres | Nightly only | — |
| `.github/workflows/staging-e2e-manual.yml` | seed → E2E → cleanup | GHA dispatch | `staging` branch only | ⚠️ Runnable with setup | `*_STAGING` secrets | Mutates staging | Manual only |
| `.github/workflows/desktop-cleaner-release.yml` | Desktop release | GHA | — | ⚠️ Runnable with setup | Release secrets | Out of app test scope | — |
| `package.json` `test` | Vitest | Node | `pnpm test` | ✅ Runnable now | — | — | — |
| `package.json` `test:signup` | Signup Playwright | Browser | `pnpm test:signup` | ⚠️ Runnable with setup | `sk_test_*` Clerk | Mutates Clerk + DB | **Excluded** from safe runner |
| `scripts/run-safe-tests.sh` | Safe aggregate | Shell | `./scripts/run-safe-tests.sh` | ✅ Runnable now | Node + pnpm | Playwright E2E optional | Blocks prod/staging URLs |
| `scripts/seed-dev.ts` | Dev seed | Node | `pnpm seed:dev:e2e` | ⚠️ Runnable with setup | `DATABASE_URL` | Writes dev fixtures | CI Playwright uses this; not production-safe |
| `server/tests/security.test.ts` | Live API security | Node fetch | Manual / separate | ⚠️ Runnable with setup | Running API | Not in default vitest include | Document in runbook |

### Vitest default exclusions (`vite.config.ts`)

| File / glob | Status | Environment | Blockers | Fix needed |
|-------------|--------|-------------|----------|------------|
| `tests/restock.service.test.ts` | ⚠️ Runnable with setup | Requires PostgreSQL + migrations | `DATABASE_URL` | Run via `DATABASE_URL=... pnpm test -- tests/restock.service.test.ts` |
| `tests/migrations/**` | ⚠️ Runnable with setup | DB | migrations applied | — |
| `tests/phase-2-3-medication-package-integration.test.ts` | ⚠️ Runnable with setup | DB | — | — |
| `tests/charge-alert-worker.test.js` | ⚠️ Runnable with setup | Live API `:3001` + Redis | Server running | — |
| `tests/code-blue-mode-equipment.test.js` | ⚠️ Runnable with setup | Live API | Server | — |
| `tests/equipment-scan-e2e.test.js` | ⚠️ Runnable with setup | Live API | Server | — |
| `tests/expiry-api.test.js` | ⚠️ Runnable with setup | Live API | Server | — |
| `tests/expiry-check-worker.test.js` | ⚠️ Runnable with setup | Live API + Redis | Server + Redis | — |
| `tests/returns-api.test.js` | ⚠️ Runnable with setup | Live API | Server | — |

---

## Playwright specs

| File | Suite | Runtime | Command | Status | Environment | Blockers | Fix needed |
|------|-------|---------|---------|--------|-------------|----------|------------|
| `tests/example.spec.ts` | Playwright template | Browser | `playwright test tests/example.spec.ts` | ❌ Broken / orphaned | External `playwright.dev` | Not VetTrack; wastes CI time | Delete or exclude from CI |
| `tests/signup-flow.spec.ts` | Signup lifecycle T1–T7 | Browser + API | `pnpm test:signup` | ⚠️ Runnable with setup | `sk_test_*` Clerk; mutates users | Destructive | **Never** in safe runner |
| `tests/ui-smoke.spec.ts` | Route screenshots | Browser | `--config=playwright.ui.config.ts` | ⚠️ Runnable with setup | Clerk session / dev bypass | 71 chromium tests when using default config | Use UI config only; exclude from default CI |
| `tests/pwa.spec.ts` | PWA audit P01–P20 | Browser | Safe runner allowlist | ⚠️ Runnable with setup | API; default `BASE_URL` is `:5000`, CI uses `:3001` | Set `TEST_BASE_URL` | Align default with CI |
| `tests/phase-9-drills.spec.ts` | Phase 9 (8 drills) | Browser + metrics | Safe runner allowlist | ⚠️ Runnable with setup | `PLAYWRIGHT_E2E`, API, seed | Long-running; SSE sensitive | Keep isolated; optional nightly |
| `tests/e2e/flows/*.spec.ts` | Flow verification | Browser + API | `PLAYWRIGHT_E2E=1 ./scripts/run-safe-tests.sh` | ✅ Runnable now | Local CI-style | API on `:3001` | — |

**Chromium test count (default config):** 71 tests in 5 files.

### Staging E2E (not default CI Playwright)

| File | Suite | Runtime | Command | Status | Environment | Blockers | Fix needed |
|------|-------|---------|---------|--------|-------------|----------|------------|
| `playwright.staging.config.ts` | Staging config | Browser | `test:staging:e2e` | ⚠️ Runnable with setup | Staging URL + secrets | Manual workflow only | — |
| `tests/staging-auth-smoke.spec.ts` | Staging auth | Browser | `pnpm test:staging:e2e` | ⚠️ Runnable with setup | Staging + seed | Mutates staging | Manual workflow only |
| `tests/staging-code-blue-gating.spec.ts` | Code Blue gates | Browser | same | ⚠️ Runnable with setup | Staging | — | — |
| `tests/staging-walkthrough.spec.ts` | Full walkthrough | Browser | `pnpm test:staging:walkthrough` | ⚠️ Runnable with setup | Staging secrets | Long; mutates | **Never** auto-run |
| `scripts/staging/seed.ts` | Persona seed | Node | `pnpm staging:seed` | ⚠️ Runnable with setup | `STAGING_E2E_CONFIRM=yes` | Clerk + DB writes | guard.ts |
| `scripts/staging/cleanup.ts` | Teardown | Node | `pnpm staging:cleanup` | ⚠️ Runnable with setup | Staging env | — | — |

---

## Vitest inventory (grouped)

**Totals:** ~239 test files under `tests/` + `server/tests/`; **236 passed** in default run.

| Group | Files (approx) | Command | Status | Environment | Blockers | Fix needed |
|-------|----------------|---------|--------|-------------|----------|------------|
| Authority / enforcement | 50+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| Code Blue / realtime / Phase 9 unit | 25+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| Auth / multi-tenancy / RBAC | 15+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| Medication / billing / inventory | 20+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| i18n / RTL / mobile / PWA unit | 15+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| ER mode | 5+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| Route / bootstrap structure | 5+ | `pnpm test` | ✅ Runnable now | Node | — | — |
| `tests/authority-cache/` | 7 | `pnpm test` | ✅ Runnable now | Node | — | — |
| `tests/integrations/` | 6 | `pnpm test` | ✅ Runnable now | Node | — | — |
| `tests/migrations/` | 1 | excluded default | ⚠️ Runnable with setup | Postgres | — | — |
| `tests/schema/` | 3 | `pnpm test` | ✅ Runnable now | Node | — | — |
| `server/tests/security.test.ts` | 1 | manual | ⚠️ Runnable with setup | Live API | Not in vitest include | Add to doc or include |
| `server/tests/shift-chat.test.ts` | 1 | `pnpm test` if included | ✅ / ⚠️ | Check include pattern | Path under `server/tests` | Verify inclusion |
| Core smoke (`basic`, `concurrency`, `offline`, `conflict`, `pwa.system`) | 5 | `pnpm test` | ✅ Runnable now | Node | — | — |

---

## Explicit exclusions (do not auto-run)

| Area | Reason |
|------|--------|
| `tests/signup-flow.spec.ts` | Creates/deletes Clerk + `vt_users` |
| `tests/staging-*` | Staging-only mutation suite |
| `tests/staging-walkthrough.spec.ts` | Requires staging secrets |
| `tests/phase-9-drills.spec.ts` against staging | SSE reconnect storm risk |
| `tests/ui-smoke.spec.ts` | Clerk session; not CI-safe default |
| `tests/example.spec.ts` | Non–VetTrack template |
| `playwright.staging.config.ts` / `pnpm test:staging:*` | Staging Railway targets |
| Any URL `vettrack.uk` or `vettrack-staging` | Production / staging protection |
| `STAGING_E2E_CONFIRM=yes` with safe runner | Use staging workflow instead |

---

## Safe runner contract (`scripts/run-safe-tests.sh`)

| Step | Included | Excluded |
|------|----------|----------|
| Frontend `tsc --noEmit` | ✅ | — |
| Server `tsc --noEmit --project tsconfig.server-check.json` | ✅ | — |
| `pnpm test` (Vitest default) | ✅ | DB/live-server excluded files |
| `playwright test --list` | ✅ | Does not execute browser tests |
| Playwright E2E (`PLAYWRIGHT_E2E=1`) | `pwa`, `phase-9-drills`, `tests/e2e/flows/` | signup, ui-smoke, example, staging-* |
| URL guard | Blocks `vettrack.uk`, `vettrack-staging`, staging Railway hosts | Production and staging (no `STAGING_E2E_CONFIRM` bypass) |

---

## Gaps & recommendations

1. **CI Playwright scope:** Default config ignores `staging-*.spec.ts` and `example.spec.ts`; still runs signup, ui-smoke, `tests/e2e/flows/`, and workday (skipped without staging env).
2. **Follow-up:** Tighten `playwright.yml` allowlist to `pwa`, `phase-9-drills`, `tests/e2e/flows/` (see `BUG_REGISTER.md` AU-01).
3. **`main` vs `staging`:** Staging tooling lives on `staging`; promote to `main` only via explicit release PR after staging E2E gate.
4. **No k6/load/** — load testing not in repo; add under `load/` if needed.
5. **Dual TypeScript checks:** CI and Release Gate both run frontend + server `tsc` — acceptable but redundant.

---

## Related artifacts

- `scripts/run-safe-tests.sh` — CI-safe runner
- `docs/playwright-matrix.md` — Playwright split matrix
- `INFRA_CLEANUP_PLAN.md` — workflows & branches
- `FLOW_MATRIX.md` — route/API coverage
- `BUG_REGISTER.md` — tracked defects
