# VetTrack — CI/CD Architecture

---

## Overview

Pipeline definitions live in **`.github/workflows/`** (GitHub Actions) and **`.gitlab-ci.yml`** (GitLab CI). They are kept in sync for when remotes resume.

**Status:** remote merge gates may be **suspended**. Local commands below are the pre-merge contract regardless.

Troubleshooting: [`.github/workflows/TROUBLESHOOTING.md`](../../.github/workflows/TROUBLESHOOTING.md)

Maintenance scope: [`docs/MAINTENANCE_MODE.md`](../MAINTENANCE_MODE.md)

---

## Workflows

| Workflow | Trigger | Merge-blocking (when CI active) |
|----------|---------|--------------------------------|
| [`ci.yml`](../../.github/workflows/ci.yml) | PR/push `main`, `staging`, `cursor/**`; manual | Yes (`Merge gate`) |
| [`playwright.yml`](../../.github/workflows/playwright.yml) | PR/push `main`, `master`, `staging` | Yes (both shards) |
| [`release-gate.yml`](../../.github/workflows/release-gate.yml) | Manual only | No (pilot readiness) |
| [`flake-detection.yml`](../../.github/workflows/flake-detection.yml) | Nightly 03:00 UTC; manual | No |
| [`e2e-simulation-nightly.yml`](../../.github/workflows/e2e-simulation-nightly.yml) | Nightly 05:00 UTC; manual | No |
| [`workday-simulation-nightly.yml`](../../.github/workflows/workday-simulation-nightly.yml) | Nightly 04:00 UTC; manual | No |
| [`staging-e2e-manual.yml`](../../.github/workflows/staging-e2e-manual.yml) | Manual on `staging` | No |

GitLab equivalents: see `.gitlab-ci.yml` stages (typecheck → build → test → integration → architecture → playwright).

---

## `ci.yml` jobs

| Job | What it does |
|-----|--------------|
| **Tests & typecheck** | `tsc`, server `tsc`, `pnpm build`, `pnpm migrate`, `pnpm test` (Postgres service) |
| **Integration ops** | `pnpm test:integration:ops` |
| **Architecture gates (G1)** | `@vettrack/contracts` gate, `tsc`, depcruise, cycle baseline, tenant/query-key/route warn-only lints |
| **Deploy pre-flight** | `deploy.sh --check` on `main` when `RAILWAY_USE_CLI_DEPLOY == 'true'` and secrets present |
| **Deploy to Railway** | `deploy.sh` when CLI deploy enabled |
| **Merge gate** | Requires test, integration-ops, architecture-gates; deploy jobs may skip |

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

Pilot/demo readiness: typecheck, full vitest, i18n parity, RTL/mobile/PWA, offline/sync, workflow integration tests, accessibility structure checks. Dispatch from Actions or GitLab pipeline UI when CI is active.

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

- `scripts/qa-native-ship-complete.sh` (local simulator captures)
- `scripts/build-native-shell.sh`, `scripts/verify-resubmission.sh`

See [`docs/capacitor-native-app.md`](../capacitor-native-app.md) and [`docs/mobile/release.md`](../mobile/release.md).

`release-gate` includes mobile/PWA vitest groups when run manually.

---

## Deployment

**Railway** on `main` push when `RAILWAY_USE_CLI_DEPLOY=true` and deploy secrets are configured. Leave disabled until explicitly approved.

---

## Caching

`actions/setup-node` with `cache: pnpm` keyed on `pnpm-lock.yaml`. GitLab: `.pnpm_cache` in `.gitlab-ci.yml`.

---

## Extending CI

1. **New vitest suite** — add to `ci.yml` / `.gitlab-ci.yml` test job; keep merge gate `needs` accurate.
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
