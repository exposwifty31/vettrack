# Contributing to VetTrack

Operational reference for engineers and agents working on VetTrack. Read
`CLAUDE.md` first — it is the architecture source of truth. This document
covers process: branches, release flow, test execution, and ops-sensitive
configuration that is easy to get wrong.

## Development workflow

**Maintenance mode:** see [`docs/MAINTENANCE_MODE.md`](docs/MAINTENANCE_MODE.md). Expo/RN work belongs in [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop).

**Git remote:** `origin` → GitHub (`github.com/exposwifty31/vettrack`). Push PRs to `origin` only. Setup: [`docs/devops/github-setup.md`](docs/devops/github-setup.md).

**CI:** remote merge gates may be suspended — run local checks below before merge. Do not push directly to `main` when MR workflow is active.

**Do not change Railway** or production deployment settings without explicit approval.

### Merge requests / pull requests

```bash
git push -u origin feat/my-change
# Open PR on github.com/exposwifty31/vettrack targeting main
```

When CI resumes, required checks include typecheck, vitest, architecture gates, and Playwright shards. Squash-merge if intermediate commits in the MR left CI red and the final head is green.

## Branches: `main` vs `staging`

- **`staging`** — integration branch. Feature work may branch from and merge into `staging`. CI runs on PRs targeting `staging` and on pushes to it.
- **`main`** — release branch. Railway deploy jobs run on `main` push when `RAILWAY_USE_CLI_DEPLOY` is enabled.
- **Promotion** — `staging → main` via reviewed merge. Scheduled workflows fire from the **default branch (`main`)** only.

### Multi-step remediation PRs

If intermediate commits left CI red (fixed by a later commit in the same PR), squash-merge. Do not preserve red commits on `staging` / `main`.

## Release flow

1. MRs merge into `staging` when that branch exists; CI enforces `tsc`, build, migrations, vitest, architecture gates, Playwright when remote CI is active.
2. `staging → main` promotion merge.
3. On push to `main`, CI runs the same gate and — when `RAILWAY_USE_CLI_DEPLOY` is enabled — deploy pre-flight + Railway deploy.
4. **Release gate** is manual: Actions → **Release Gate** → **Run workflow**. Trigger before a pilot/demo release.

## Running tests

```bash
pnpm test                 # vitest — unit + integration (default scope)
npx tsc --noEmit          # frontend typecheck — run after every change
npx tsc --noEmit --project tsconfig.server-check.json   # server typecheck
bash scripts/ci/contracts-gate.sh   # @vettrack/contracts + emergency parity
```

### Test groups excluded from `pnpm test` by default

`vite.config.ts` excludes suites that need infrastructure the default run
does not provide. They must be run deliberately, with that infrastructure:

- **DB integration** (require `DATABASE_URL` + applied migrations):
  `tests/restock.service.test.ts`, `tests/migrations/**`,
  `tests/phase-2-3-medication-package-integration.test.ts`.
- **Live-server integration** (require the dev server on `:3001`):
  `tests/charge-alert-worker.test.js`, `tests/code-blue-mode-equipment.test.js`,
  `tests/equipment-scan-e2e.test.js`, `tests/expiry-api.test.js`,
  `tests/expiry-check-worker.test.js`, `tests/returns-api.test.js`.
- **Playwright** — browser suites run via the `PW_SUITE` allowlist
  (`pnpm test:playwright:ci`), not `pnpm test`. The `e2e/simulation` workday
  suite runs nightly only.

A release must account for these — the default `pnpm test` is **not** full
coverage. Run the DB and live-server suites against a real database / running
server as part of release validation.

## Deployment & infrastructure config

- **`RAILWAY_USE_CLI_DEPLOY`** — GitHub repository variable. When `true`, the
  `deploy-check` and `deploy` jobs in `.github/workflows/ci.yml` run on push
  to `main`; when unset/false they are skipped (the merge gate tolerates
  skipped deploy jobs).
- **Redis is required in production.** Redis is optional in dev (queues log
  `QUEUE_DISABLED_NO_REDIS` and the app still runs), but every BullMQ worker
  and scheduler in `server/app/start-schedulers.ts` needs Redis in prod.
  A missing/dead worker surfaces as a readiness `503` on
  `GET /health/ready` (`checks.worker`).
- **`SMART_COP_VALIDATION_FAIL_OPEN`** — keep `false` in production (SE-07).
  When `true` an enforcement evaluator may degrade to *allow* if its own DB
  reads throw, emitting the `clinical_invariant_fail_open` audit kind. That
  is a deliberate availability carve-out and must be a conscious choice, not
  a default.

### DATA_INTEGRITY_HEALTH_TOKEN (production-required)

Production deployments MUST set this secret before relying on `/api/health/data-integrity`.

**Endpoint paths:** `/api/health/data-integrity` (primary) and `/health/data-integrity` (alias). Both enforce the token in production.

All `/api/health/*` routes are also mounted at `/health/*` (see `server/app/routes.ts`).

| Condition | Response |
|-----------|----------|
| Production + unset | `503 HEALTH_TOKEN_NOT_CONFIGURED` |
| Production + mismatch | `401 INVALID_HEALTH_TOKEN` |
| Production + match | `200 { ok: true, ... }` |
| Non-production | `200` (no token required) |

Set in: Railway → Variables → Production AND Staging.

Monitoring callers must include header:

```
x-health-token: <value>
```

Rotate quarterly. Coordinate rotation across all uptime monitors before changing the secret.

## Auth in tests vs production

- Dev-bypass auth (no Clerk keys) hardcodes an admin `DEV_USER` with
  `clinicId = "dev-clinic-default"`. This is for local dev and E2E only.
- E2E dev auth headers / `PLAYWRIGHT_E2E` are **test-only**. They must never
  be enabled in production. Production resolves auth through Clerk and always
  reads role from `vt_users.role` in the DB — never from JWT claims.

## Behaviours worth knowing

- **Role alias normalization** — incoming role aliases are normalized to the
  canonical hierarchy (`admin · vet · senior_technician · technician ·
  student`). Compare roles numerically; do not string-match raw claims.
- **Inventory jobs (removed)** — medication tasks and async inventory deduction were removed in migration 143. `inventory-deduction.worker` is a no-op stub. Inventory dispense/restock flows are synchronous via inventory services — see [`docs/scope-change-2026.md`](docs/scope-change-2026.md).

## Per-change checklist

1. `npx tsc --noEmit` (frontend + server) — zero errors.
2. Run the named tests for the area you touched; add tests for new behaviour.
3. Schema change → edit `server/db.ts`, add the `migrations/NNN_*.sql` file
   (runtime applies it via `runMigrations()` at startup).
4. New user-facing copy → keys in both `locales/en.json` + `locales/he.json`
   (parity enforced); access via the typed `t.*` accessor.
5. Keep every query `clinicId`-scoped.
6. Do not touch the frozen architecture surfaces — see `CLAUDE.md`.
