# VetTrack — CI/CD Architecture

---

## Overview

Pipeline definitions live in **`.github/workflows/`** (GitHub Actions).

**Status:** GitHub Actions is active on `origin`. Local commands below are the pre-merge contract regardless.

Troubleshooting: [`.github/workflows/TROUBLESHOOTING.md`](../../.github/workflows/TROUBLESHOOTING.md)

Maintenance scope: [`docs/MAINTENANCE_MODE.md`](../MAINTENANCE_MODE.md)

---

## Workflows

| Workflow | Trigger | Merge-blocking (when CI active) |
|----------|---------|--------------------------------|
| [`ci.yml`](../../.github/workflows/ci.yml) | PR/push `main`; manual | Yes (`Merge gate`) |
| [`playwright.yml`](../../.github/workflows/playwright.yml) | PR/push `main` | Yes (both shards) |
| [`release-gate.yml`](../../.github/workflows/release-gate.yml) | Manual only | No (pilot readiness) |
| [`flake-detection.yml`](../../.github/workflows/flake-detection.yml) | Nightly 03:00 UTC; manual | No |
| [`e2e-simulation-nightly.yml`](../../.github/workflows/e2e-simulation-nightly.yml) | Nightly 05:00 UTC; manual | No |
| [`workday-simulation-nightly.yml`](../../.github/workflows/workday-simulation-nightly.yml) | Nightly 04:00 UTC; manual | No |
| [`staging-e2e-manual.yml`](../../.github/workflows/staging-e2e-manual.yml) | Manual on `staging` | No |

---

## `ci.yml` jobs

| Job | What it does |
|-----|--------------|
| **Tests & typecheck** | `tsc`, server `tsc`, `pnpm build`, `pnpm migrate`, `pnpm test` (Postgres service) |
| **Integration ops** | `pnpm test:integration:ops` |
| **Architecture gates (G1)** | `@vettrack/contracts` gate, `tsc`, depcruise, cycle baseline, tenant/query-key/route warn-only lints |
| **Deploy to Railway** | push/dispatch on `main` when `vars.RAILWAY_USE_CLI_DEPLOY == 'true'`; needs test + integration-ops + architecture-gates; runs `deploy.sh` (preflight → `railway up --ci` VetTrack → status poll → healthcheck curl → `railway up --ci` Worker → status poll) |
| **Merge gate** | Requires test, integration-ops, architecture-gates; deploy may skip (PR runs) but must not fail |

### `@vettrack/contracts` gate

`scripts/ci/contracts-gate.sh`:

- `pnpm run contracts:typecheck` (`@vettrack/contracts` from literate-dollop)
- `tests/offline-phase-7-emergency-surface-parity.test.ts`

Shared types are authored in [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop); this repo consumes and validates parity only.

---

## `playwright.yml`

Two shards run `pnpm test:playwright:ci` against a local API on `127.0.0.1:3001` (build, migrate, seed, `pnpm dev:api`). Artifacts: Playwright report + dev log on failure (30 days).

---

## Release gate (manual)

Pilot/demo readiness: typecheck, full vitest, i18n parity, RTL/mobile/PWA, offline/sync, workflow integration tests, accessibility structure checks. Dispatch from GitHub Actions UI.

---

## Nightlies

| Workflow | Time (UTC) | Target |
|----------|------------|--------|
| Flake detection | 03:00 | Repeat vitest suite (`FLAKE_REPEAT_COUNT`) |
| Workday (staging) | 04:00 | Deployed staging (`TEST_BASE_URL_STAGING`; skips if unset) |
| E2E simulation | 05:00 | Local build + `e2e/simulation` suite |

All nightlies are **non-blocking** (`continue-on-error` or observational only).

---

## Mobile / native CI

No automated iOS simulator screenshots or macOS Capacitor builds in CI today. Pre-release:

- `scripts/build-native-shell.sh`, `scripts/verify-resubmission.sh`

See [`docs/capacitor-native-app.md`](../capacitor-native-app.md) and [`docs/mobile/release.md`](../mobile/release.md).

`release-gate` includes mobile/PWA vitest groups when run manually.

---

## Deployment

**CI-driven Railway CLI deploy is the canonical (and only) path to production.** Railway's GitHub auto-deploy is disconnected for the production `VetTrack` and `Worker` services — the `deploy` job in `ci.yml` deploys both via `railway up --ci` after all merge gates pass, then polls the deployment status to `SUCCESS` and curls the public healthcheck. A green deploy job means *deployed and serving*, not merely queued.

| Config | Where | Value |
|--------|-------|-------|
| `RAILWAY_USE_CLI_DEPLOY` | repo **variable** (not secret) — deploy kill-switch | `true` |
| `RAILWAY_TOKEN` | repo secret | Railway project token (production environment) |
| `RAILWAY_SERVICE` | repo secret | VetTrack service ID |
| `RAILWAY_WORKER_SERVICE` | repo secret | Worker service ID (unset ⇒ worker deploy skipped) |

**Railway dashboard source-of-truth** (deploy settings intentionally live per-service in the dashboard — the shared `railway.json` is build-only so the Worker never inherits a web healthcheck or start command):

| Service (production) | Start command | Healthcheck |
|----------------------|---------------|-------------|
| VetTrack | `pnpm start` | `/api/healthz` (timeout 300s) |
| Worker | `pnpm worker` | none (no HTTP server) |

Both services build from the root `Dockerfile` (pinned in `railway.json`).

**Known limitation:** `playwright.yml` is a separate workflow, so the deploy job cannot `needs:` it. Branch protection (both Playwright shards required + strict up-to-date) guarantees Playwright passed on the exact merged tree; a push-run Playwright failure on `main` does not retroactively block the deploy.

**Staging** (`Staging ` environment) auto-deploys from `main` via Railway's GitHub integration — it is a mirror of production code with staging variables, not a pre-production gate.

---

## Caching

`actions/setup-node` with `cache: pnpm` keyed on `pnpm-lock.yaml`.

---

## Extending CI

1. **New vitest suite** — add to `ci.yml` test job; keep merge gate `needs` accurate.
2. **New shared mobile contract check** — extend `scripts/ci/contracts-gate.sh`.
3. **New nightly** — new workflow with `schedule` + `workflow_dispatch` only.

---

## Local parity before push

```bash
pnpm install --frozen-lockfile
npx tsc --noEmit
pnpm exec tsc --noEmit --project tsconfig.server-check.json
bash scripts/ci/contracts-gate.sh
pnpm migrate && pnpm test
pnpm architecture:gates   # optional full G1 locally
```
