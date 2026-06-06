# Contributing to VetTrack

Operational reference for engineers and agents working on VetTrack. Read
`CLAUDE.md` first — it is the architecture source of truth. This document
covers process: branches, release flow, test execution, and ops-sensitive
configuration that is easy to get wrong.

## GitLab-first development (active)

GitHub is temporarily unavailable. **Use GitLab as the primary remote:**

- Remote: `https://gitlab.com/dboy3156/vettrack`
- Full workflow: **`docs/GITLAB_DEVELOPMENT.md`**
- CI: `.gitlab-ci.yml` (not `.github/workflows/` — preserved for GitHub return)
- **Do not push directly to `main`.** Open merge requests (MRs) instead.
- **Do not change Railway** or production deployment settings during the outage.

### MR instead of PR

| GitHub (paused) | GitLab (active) |
|-----------------|-----------------|
| `gh pr create` | GitLab UI, `glab mr create`, or MCP `create_merge_request` |
| Pull request | Merge request (MR) |
| Actions run on PR | CI runs on MR targeting `main` or `staging` |
| Squash merge | Squash merge (same rule for red intermediate commits) |

Verify per-commit CI before merge (GitLab):

```bash
glab mr view <iid> --web   # open MR
# In GitLab UI: MR → Pipelines → view commit pipelines
# Squash-merge required if any intermediate commit failed CI
```

## Branches: `main` vs `staging`

- **`staging`** — integration branch. Feature work and audit-remediation MRs
  branch from and merge into `staging`. GitLab CI (`.gitlab-ci.yml`) runs
  on merge requests targeting `staging` and on pushes to it.
- **`main`** — release branch. `main` is what deploys. The Release Gate
  (`release-gate:*` jobs in `.gitlab-ci.yml`) and the Railway deploy jobs are
  gated to `main`.
- **Promotion** — changes flow `staging → main` via a deliberate, reviewed
  merge. Scheduled workflows (e.g. `workday-simulation-nightly.yml`) only
  fire from the **default branch (`main`)** — a workflow file that lives only
  on `staging` will never run on its cron until promoted to `main`.

### Multi-step remediation MRs

If intermediate commits in an MR left CI red (because a later commit in the same MR fixes them), the MR MUST be squash-merged. Do not preserve red commits on `staging` history — bisect must remain meaningful.

How to verify before merge (GitLab):

```bash
glab mr view <iid> --web
# Review pipeline status per commit in the MR Commits tab
```

If any intermediate commit shows a failed pipeline, squash-merge is required.

## Release flow

1. MRs merge into `staging`; `.gitlab-ci.yml` enforces `tsc` (frontend + server),
   the frontend build, migrations, and the full `vitest` suite.
2. `staging → main` promotion merge.
3. On push to `main`, CI runs the same gate and — when
   `RAILWAY_USE_CLI_DEPLOY` is enabled — the deploy pre-flight + Railway
   deploy jobs.
4. **Release gate** is a **manual** pipeline run (CI/CD → Run pipeline on `main`).
   It is not automatic; trigger it before a release. The automatic typecheck +
   full suite on `main` is owned by the main CI jobs (de-duplicated from
   release-gate — see PR-05 / DP-04).

## Running tests

```bash
pnpm test                 # vitest — unit + integration (default scope)
npx tsc --noEmit          # frontend typecheck — run after every change
npx tsc --noEmit --project tsconfig.server-check.json   # server typecheck
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

- **`RAILWAY_USE_CLI_DEPLOY`** — GitLab CI/CD variable. When `true`, the
  `deploy:preflight` and `deploy:railway` jobs in `.gitlab-ci.yml` run on push
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
- **Async inventory skew** — `completeTask` commits task completion + billing
  atomically, then enqueues a `vt_inventory_jobs` row processed by
  `inventory-deduction.worker`. Billing and inventory can therefore be
  briefly inconsistent immediately after `completeTask` returns; a 10-minute
  recovery sweep re-enqueues stale/failed jobs. Tests and UIs must tolerate
  this skew rather than assuming immediate inventory consistency.

## Per-change checklist

1. `npx tsc --noEmit` (frontend + server) — zero errors.
2. Run the named tests for the area you touched; add tests for new behaviour.
3. Schema change → edit `server/db.ts`, add the `migrations/NNN_*.sql` file
   (runtime applies it via `runMigrations()` at startup).
4. New user-facing copy → keys in both `locales/en.json` + `locales/he.json`
   (parity enforced); access via the typed `t.*` accessor.
5. Keep every query `clinicId`-scoped.
6. Do not touch the frozen architecture surfaces — see `CLAUDE.md`.
