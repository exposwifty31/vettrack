# VetTrack — CI/CD Architecture

---

## Overview

VetTrack uses **GitLab CI** (`.gitlab-ci.yml`). The pipeline runs on merge requests and protected branches (`main`, `staging`) and on scheduled triggers for nightly simulation and flake detection.

---

## Pipeline stages

```
typecheck → build → test → integration → architecture → deploy → playwright → flake-detection → release-gate → e2e-simulation → workday-simulation → staging-e2e
```

---

## Stage breakdown

### `typecheck`
| Job | What it checks |
|-----|---------------|
| `typecheck:frontend` | `tsc --noEmit` (frontend tsconfig) |
| `typecheck:server` | `tsc --noEmit --project tsconfig.server-check.json` |

Both jobs run on every branch/MR.

---

### `build`
| Job | What it does |
|-----|-------------|
| `build:frontend` | `pnpm build` — Vite production bundle → `dist/public` |

Needs: both typecheck jobs. Sets dummy `VITE_CLERK_PUBLISHABLE_KEY` if unset (CI-safe).

---

### `test`
| Job | What it does |
|-----|-------------|
| `test:vitest` | `pnpm migrate && pnpm test` — full vitest suite (318 tests) |

Uses PostgreSQL service container (`vettrack_test` database). Runs after `build:frontend`.

---

### `integration`
| Job | What it does |
|-----|-------------|
| `integration:ops` | `pnpm test:integration:ops` — ops-critical integration tests |

---

### `architecture`
| Job | What it checks |
|-----|---------------|
| `architecture:gates` | Typecheck + depcruise boundary enforcement + cycle detection + tenant-query lint + query key audit + route contract |

Uses `GIT_DEPTH: "0"` for accurate diff-based lint. The tenant-query lint and query-key audit are warn-only (non-blocking).

---

### `deploy`
| Job | When it runs |
|-----|-------------|
| `deploy:preflight` | `main` pushes only (when `RAILWAY_USE_CLI_DEPLOY=true`) — validates env vars, runs `deploy.sh --check` |
| `deploy:railway` | `main` pushes only — Railway CLI deploy |
| `ci:merge-gate` | All branches/MRs — final checkpoint requiring all prior jobs |

---

### `playwright`
| Job | What it tests |
|-----|--------------|
| `playwright:shard-1` | E2E Playwright suite, shard 1 of 2 |
| `playwright:shard-2` | E2E Playwright suite, shard 2 of 2 |

Runs on MRs targeting `main`/`staging` and on `main`/`staging` pushes. Uses Chromium. Artifacts retained 30 days.

---

### `release-gate`
Triggered by `$CI_PIPELINE_SOURCE == "web"` (manual pipeline runs, not automatic). All jobs run; `release-gate:verdict` aggregates.

| Job | Tests |
|-----|-------|
| `release-gate:typecheck` | Frontend + server TypeScript |
| `release-gate:tests` | Full vitest suite (verbose) |
| `release-gate:i18n` | Locale parity (en/he key count match) + no-hardcoded-ui-strings + i18n-hardening |
| `release-gate:rtl-mobile` | Phase 4 RTL, Phase 8 mobile/PWA, mobile nav, procurement mobile, UI tokens |
| `release-gate:offline-sync` | Offline, sync queue, PWA system tests |
| `release-gate:workflows` | Medication calc, equipment scan lifecycle, auth hardening, multi-tenancy, data integrity, error contracts, state consistency |
| `release-gate:accessibility` | Reduced motion, route registration, frontend routing structure, server bootstrap structure |
| `release-gate:verdict` | Aggregator — passes only when all above pass |

---

### `flake-detection`
Scheduled daily (03:00 UTC). Runs the vitest suite N times in parallel (configurable `FLAKE_REPEAT_COUNT=3`) to detect intermittent failures. Artifacts retained 14 days.

---

### `e2e-simulation`
Scheduled nightly (05:00 UTC). Full Playwright workday simulation against a local test server. `allow_failure: true`. Artifacts retained 30 days.

---

### `workday-simulation`
Scheduled nightly (04:00 UTC). Playwright workday simulation against **staging** (`TEST_BASE_URL_STAGING`). Skips gracefully if staging URL not configured.

---

### `staging-e2e`
Manual trigger on `staging` branch. Runs full staging E2E smoke + walkthrough tests.

---

## Mobile CI (Cap sync validation)

`mobile:ios-integrity` and `mobile:android-integrity` were **removed** from `.gitlab-ci.yml` (see `ARTIFACTS.md`) after repeated CI failures and missing macOS/Android runner provisioning. They are **not active** in the current pipeline.

Capacitor integrity checks (`npx cap sync`, native project file verification) are manual pre-release steps today. Full iOS/Android store builds require a macOS/Android Studio runner and are not yet automated in CI. See [`docs/mobile/release.md`](../mobile/release.md) for manual build instructions.

---

## Deployment

Production deployment target: **Railway**. Triggered automatically on `main` pushes when `RAILWAY_USE_CLI_DEPLOY=true` is set.

Pipeline: `typecheck → build → test → deploy:preflight → deploy:railway`

The `deploy:preflight` job runs `deploy.sh --check` which validates:
- Required env vars present
- Database reachable
- Migrations up to date
- Build output exists

---

## Caching strategy

pnpm cache keyed on `pnpm-lock.yaml` hash. Both `node_modules/` and `.pnpm-store/` are cached (pull-push policy).

---

## Artifacts

| Job | Artifact | Retention |
|-----|---------|-----------|
| `playwright:shard-*` | `playwright-report/` | 30 days |
| `flake-detection:run` | `flake-test-run-*.log` | 14 days |
| `e2e-simulation:nightly` | `playwright-report/` | 30 days |
| `workday-simulation:nightly` | `artifacts/` | 14 days |

---

## Extending the pipeline

1. **New test suite:** add a job extending `.node_job` or `.postgres_service` in the appropriate stage
2. **New deploy target:** add to the `deploy` stage; gate on branch + `$SOME_FLAG`
3. **New nightly check:** add a scheduled pipeline trigger + `$SCHEDULED_JOB` variable

Never weaken the `ci:merge-gate` job's `needs` list — it is the merge gatekeeping signal.
