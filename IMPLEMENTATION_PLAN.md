# VetTrack — Audit Remediation Implementation Plan (Sections B · D · F)

## Context

A read-only audit of VetTrack (branch `staging`) produced three registers:

- **Section B — GitHub + Railway Infrastructure Audit** → `INFRA_CLEANUP_PLAN.md`
- **Section D — Flow Verification Matrix** → `FLOW_MATRIX.md`
- **Section F — Bug Hunt & Hardening Register** → `BUG_REGISTER.md`

The registers identify defects and gaps but contain **no fixes** by design.
This document is the remediation plan: it converts every *actionable* finding
into the **smallest independent PR** that can be implemented and reverted on
its own. Nine representative Section F findings (CO-01, IB-03, AU-01, DP-03,
TZ-01, SE-05, EU-01, EU-03, CD-01, CD-02) were verified against current code —
all accurate.

**Goal:** ship the audit remediation as a series of small, low-blast-radius
PRs that restore CI signal, close correctness/safety gaps, and build out the
flow-verification test suite — without touching frozen architecture surfaces.

## How to use this plan

- **Intended executor:** Cursor Composer 2.5. Each PR block below is a
  self-contained task; feed them one at a time.
- **Base branch:** every PR branches from `origin/staging`. Branch naming:
  `cursor/<theme>-<short-id>`.
- **Per-PR gate:** `npx tsc --noEmit` must pass with zero errors; run the
  named tests; one Conventional-Commit message; PR body states **Risk /
  Rollback / Validation / Deployment impact**.
- **Independence:** PRs are ordered by dependency but each is revertable
  alone. Where a dependency exists it is called out explicitly.
- **Do not touch frozen surfaces** (see `CLAUDE.md` → "Frozen architecture
  surfaces" and "Operational doctrine"): SSE transport, BroadcastChannel
  envelope, PWA build-tag, emergency-endpoint cache denylist, enforcement
  `off|shadow|enforce` envelope, Strategy A safety net, `appointmentsPage.*`
  namespace, closed `AuditActionType` union, telemetry cardinality.

## Scope summary

- **39 code/test/CI PRs** across 11 phases (PR-01 … PR-39).
- **Operations-only items** (cannot be done from code) are listed at the end
  and excluded from the PR catalog.

---

## Phase 0 — Audit registers & this plan

### PR-01 — Commit the audit registers and remediation plan
- **Branch:** `cursor/audit-registers-doc`
- **Findings:** Section B/D/F deliverables; `BUG_REGISTER.md` companion-artifact refs.
- **Files (new, repo root):** `BUG_REGISTER.md` (Section F verbatim),
  `FLOW_MATRIX.md` (Section D verbatim), `INFRA_CLEANUP_PLAN.md` (Section B
  verbatim), `IMPLEMENTATION_PLAN.md` (this document).
- **Changes:** create the four markdown files; reconstruct any
  newline-collapsed source into well-formed tables; do not fabricate
  `TEST_AUDIT.md` / `scripts/run-safe-tests.sh` (content not supplied).
- **Validation:** markdown renders; `git diff --stat` shows only new `.md`.
- **Risk:** none (docs). **Rollback:** revert commit.

---

## Phase 1 — CI/CD & workflow signal (no app code, low risk)

### PR-02 — Narrow Playwright CI scope
- **Branch:** `cursor/ci-playwright-allowlist`
- **Findings:** AU-01, TI-01, TI-04.
- **Files:** `.github/workflows/playwright.yml`, `playwright.config.ts`.
- **Changes:** restrict the CI Playwright run to safe, deterministic specs
  (`pwa`, `phase-9-drills`, `tests/e2e/flows/`); exclude `signup-flow.spec.ts`
  (Clerk mutations) and `ui-smoke.spec.ts` (session) via `testIgnore` or an
  explicit project/`--grep`. Keep the run aligned with the intended safe
  allowlist.
- **Validation:** CI Playwright job green; job log shows no signup/ui-smoke.
- **Risk:** low. **Rollback:** revert workflow.

### PR-03 — Run CI on `staging` branch
- **Branch:** `cursor/ci-staging-branch`
- **Findings:** DP-03; Section B "CI does not run on push to staging".
- **Files:** `.github/workflows/ci.yml`, `.github/workflows/playwright.yml`.
- **Changes:** add `staging` to `push` and `pull_request` branch filters so
  PRs targeting `staging` get the `tsc + vitest + build` and Playwright gates.
- **Validation:** open a no-op PR into `staging`; confirm `ci.yml` runs.
- **Risk:** low. **Rollback:** revert workflow.

### PR-04 — Fix workday-simulation-nightly workflow
- **Branch:** `cursor/workday-nightly-fix`
- **Findings:** Section B workflow audit.
- **Files:** `.github/workflows/workday-simulation-nightly.yml`.
- **Changes:** the scheduled run executes on the default branch (`main`) while
  `if: github.ref == 'refs/heads/staging'` skips it — the nightly never runs.
  Either gate by `schedule` + `workflow_dispatch` with a checkout of the
  `staging` ref, or remove the impossible `if`. Plan promotion of the file to
  `main` so the cron is active.
- **Validation:** `workflow_dispatch` trigger executes the job end-to-end.
- **Risk:** low. **Rollback:** disable workflow.

### PR-05 — Consolidate Release Gate vs CI overlap
- **Branch:** `cursor/release-gate-dedupe`
- **Findings:** DP-04.
- **Files:** `.github/workflows/release-gate.yml`, `.github/workflows/ci.yml`.
- **Changes:** remove vitest subsets duplicated between `release-gate.yml` and
  `ci.yml`; keep release-gate as the thin release-only check or mark
  overlapping jobs optional.
- **Validation:** push to `main` (or dispatch) runs each suite once.
- **Risk:** low. **Rollback:** revert workflow.

### PR-06 — Add e2e/simulation to a nightly workflow
- **Branch:** `cursor/ci-e2e-simulation-nightly`
- **Findings:** TI-02.
- **Files:** new/updated nightly workflow under `.github/workflows/`.
- **Changes:** run `tests/e2e/simulation/**` on a nightly schedule (not on PR).
- **Validation:** dispatch run green.
- **Risk:** low. **Rollback:** revert workflow.

### PR-07 — Shard the Playwright CI job
- **Branch:** `cursor/ci-playwright-shard`
- **Findings:** PF-04.
- **Files:** `.github/workflows/playwright.yml`.
- **Changes:** split by spec dir or use Playwright `--shard` matrix to cut PR
  feedback time; keep `globalTimeout` sane per shard.
- **Validation:** total wall-clock drops; all shards green.
- **Risk:** low. **Rollback:** revert workflow.

### PR-08 — Remove stale example spec
- **Branch:** `cursor/remove-example-spec`
- **Findings:** AU-04.
- **Files:** delete `tests/example.spec.ts`.
- **Validation:** `pnpm test` / Playwright unaffected.
- **Risk:** none. **Rollback:** restore file.

### PR-09 — Fix `pwa.spec.ts` base URL default
- **Branch:** `cursor/pwa-base-url`
- **Findings:** CD-02.
- **Files:** `tests/pwa.spec.ts` (~L36).
- **Changes:** drop the `http://localhost:5000` fallback; use
  `process.env.TEST_BASE_URL` and fail fast (or default to the Playwright
  config value `http://127.0.0.1:3001`) so the spec and `playwright.config.ts`
  agree.
- **Validation:** run `pwa.spec.ts` with and without `TEST_BASE_URL`.
- **Risk:** low. **Rollback:** revert spec.

---

## Phase 2 — Quick correctness & UX fixes (low risk)

### PR-10 — ER handoff ack route guard
- **Branch:** `cursor/er-handoff-ack-guard`
- **Findings:** AU-02.
- **Files:** `server/routes/er.ts` (`POST /handoffs/:id/ack`, ~L797).
- **Changes:** add `requireAssignableRole` (or an explicit clinical-floor
  guard) to the ack route, matching create/assign routes (~L360/L762); block
  `student` at the route layer. Service-layer owner / admin-vet override in
  `er-handoff.service.ts` (~L149-158) stays.
- **Validation:** new vitest — `student` → 403; owner/assignable → 200.
- **Risk:** low. **Rollback:** revert route.

### PR-11 — ER queue contract alignment
- **Branch:** `cursor/er-queue-contract`
- **Findings:** CD-01, EU-04.
- **Files:** `src/lib/er-api.ts` (~L22-27, L51), `server/routes/er.ts`
  (~L843-845).
- **Changes:** the queue handler returns 501 but `ER_API_IMPLEMENTED_ROUTES`
  lists `GET /api/er/queue` as implemented. Remove it from the implemented
  list (recommended — queue not built); ensure any client call maps the 501 to
  the typed `ErApiNotImplementedError` rather than a generic error.
- **Validation:** ER api unit test; admin tooling no longer shows it implemented.
- **Risk:** low. **Rollback:** revert.

### PR-12 — Data-integrity health endpoint fail-closed
- **Branch:** `cursor/health-data-integrity-auth`
- **Findings:** SE-05.
- **Files:** `server/routes/health.ts` (~L199-217).
- **Changes:** `GET /health/data-integrity` currently authenticates only when
  `DATA_INTEGRITY_HEALTH_TOKEN` is set. In `production`, require the token to
  be configured **and** matched — fail closed (503/500 on missing config, 401
  on mismatch). Non-prod behaviour unchanged.
- **Validation:** vitest — prod + unset token → not 200; prod + wrong token →
  401; prod + correct token → 200.
- **Risk:** low (env-gated). **Rollback:** revert route.

---

## Phase 3 — i18n debt extraction

### PR-13 — Crash-cart error string i18n
- **Branch:** `cursor/i18n-crash-cart`
- **Findings:** EU-03.
- **Files:** `src/pages/crash-cart.tsx` (~L95), `locales/he.json`,
  `locales/en.json`, `tests/i18n-no-hebrew-in-source.test.ts` (allowlist).
- **Changes:** extract the hardcoded Hebrew error to a new typed `t.*` key in
  both locales; regenerate i18n types (`scripts/i18n/generate-types.ts`);
  remove `crash-cart.tsx` from the `KNOWN_DEBT_ALLOWLIST`.
- **Validation:** `tests/i18n-parity.test.ts` + `i18n-no-hebrew-in-source`
  pass; `npx tsc --noEmit` clean.
- **Risk:** low. **Rollback:** revert.

### PR-14 — Forecast email builder i18n
- **Branch:** `cursor/i18n-forecast-email`
- **Findings:** SE-06.
- **Files:** server forecast email builder (`server/lib/forecast*`),
  `locales/*.json`, i18n allowlist test.
- **Changes:** extract Hebrew copy from the server email builder into locale
  files; render per `req.locale`; shrink the allowlist.
- **Validation:** parity + no-Hebrew-in-source tests pass.
- **Risk:** low. **Rollback:** revert.

---

## Phase 4 — Validation hardening

### PR-15 — Zod `.strict()` on sensitive routes
- **Branch:** `cursor/zod-strict-routes`
- **Findings:** VA-01.
- **Files:** route schemas under `server/routes/` (dispense, medication-tasks,
  code-blue, billing, equipment checkout/return, inventory-items,
  procurement). `restock.ts` and `clinical-check-in.ts` already use `.strict()`.
- **Changes:** add `.strict()` to body schemas on high-risk write routes so
  unknown JSON fields are rejected, not silently dropped. One commit per route
  family if Composer prefers finer PRs.
- **Validation:** negative vitest per route — unknown field → 400.
- **Risk:** medium (could reject lenient existing callers — audit client
  payloads first). **Rollback:** per-route revert.

### PR-16 — Negative-body validation test matrix
- **Branch:** `cursor/validation-negative-tests`
- **Findings:** VA-02.
- **Files:** new `tests/*-validation.test.ts`.
- **Changes:** per-route-family negative tests (missing required, wrong type,
  out-of-range) to lock the validator surface.
- **Validation:** `pnpm test` green.
- **Risk:** low (tests only). **Rollback:** delete tests.

### PR-17 — Appointment datetime ISO contract test + UI guard
- **Branch:** `cursor/appointment-datetime-contract`
- **Findings:** VA-03.
- **Files:** new API contract test for `parseAppointmentInstant`
  (`server/services/appointments.service.ts` ~L826-845); a lint/test ensuring
  the UI sends ISO strings with offset/`Z`.
- **Validation:** test rejects offset-less strings; accepts ISO+offset.
- **Risk:** low. **Rollback:** delete tests.

---

## Phase 5 — Concurrency

### PR-18 — Equipment optimistic concurrency control
- **Branch:** `cursor/equipment-version-occ`
- **Findings:** CO-01, CO-02.
- **Files:** `server/routes/equipment.ts` (PATCH ~L775-794, checkout
  ~L1184-1195, return ~L1292-1333), `src/lib/api.ts`, `src/types/`,
  equipment edit/checkout/return UI.
- **Changes:** the `vt_equipment.version` column (`server/db.ts` ~L382) is
  never read or written. Implement read-modify-write OCC: accept the client's
  expected `version`, `UPDATE ... SET version = version + 1 WHERE id = ? AND
  clinicId = ? AND version = ?`; on zero rows affected return **409** with a
  stable reason code. Thread `version` through `src/lib/api.ts` + types + the
  forms. Keep the existing timestamp-based checkout conflict (409) or replace
  it with version OCC consistently — document whichever is chosen.
- **Validation:** vitest concurrency test (two writers, one wins / one 409);
  manual double-PATCH.
- **Risk:** medium — API contract change. **Rollback:** revert routes; the DB
  column is already nullable-defaulted so no migration rollback needed.

### PR-19 — Equipment double-submit / duplicate-scan E2E
- **Branch:** `cursor/e2e-duplicate-scan`
- **Findings:** CO-04.
- **Files:** new `tests/e2e/flows/duplicate-scan.spec.ts`.
- **Changes:** Playwright spec for rapid double-scan / double-submit on the
  scanner path; asserts idempotent outcome.
- **Validation:** spec green.
- **Risk:** low (test only). **Rollback:** delete spec.

---

## Phase 6 — Inventory & billing integrity

### PR-20 — Negative-inventory database guard
- **Branch:** `cursor/inventory-negative-guard`
- **Findings:** IB-03.
- **Files:** `server/db.ts` (`vt_container_items`, `vt_containers`), new SQL
  in `migrations/`, `server/services/dispense.service.ts` (~L530, L688).
- **Changes:** add DB `CHECK (quantity >= 0)` on `vt_container_items.quantity`
  and `CHECK (current_quantity >= 0)` on `vt_containers.currentQuantity` via
  `npx drizzle-kit generate` (or a hand-written migration if drizzle omits the
  CHECK). Confirm `dispense.service.ts` cannot persist a negative `newQty`
  (guard/clamp before write). `inventory.service.ts` already floors at 0.
- **Validation:** DB integration test — concurrent dispense cannot drive
  on-hand negative; `data-integrity` views clean.
- **Risk:** high if wrong (constraint could reject a legitimate write — verify
  every decrement path floors first). **Rollback:** drop the CHECK in a
  follow-up migration; revert service guard.

### PR-21 — Inventory job failure retry UX
- **Branch:** `cursor/inventory-job-failure-ux`
- **Findings:** IB-04.
- **Files:** `src/pages/inventory-jobs.tsx`.
- **Changes:** after worker retry exhaustion, surface a clear operator retry
  path on the failed-jobs filter (visible action + status copy via `t.*`).
- **Validation:** manual — exhaust a job, confirm retry affordance.
- **Risk:** low. **Rollback:** revert page.

---

## Phase 7 — Timezone correctness

### PR-22 — Clinic timezone column + "today" boundaries
- **Branch:** `cursor/appointments-clinic-tz`
- **Findings:** TZ-01, TZ-03.
- **Files:** `server/db.ts` (`vt_clinics` — add `timezone text not null
  default 'Asia/Jerusalem'`), new `migrations/` SQL,
  `server/services/appointments.service.ts` (`getTasksForTechnicianToday`
  ~L2025, `getAppointmentsByDay` ~L2117), `server/lib/authority-cache.ts`
  (~L41 day comment).
- **Changes:** day boundaries are built with `T00:00:00.000Z` (UTC). Compute
  start/end of "today" in the clinic timezone instead (use an existing date
  library or add `date-fns-tz`). Align the authority-cache "day" with the
  clinic TZ or document the divergence.
- **Validation:** extend `tests/appointments-scheduling.test.js` with
  Asia/Jerusalem boundary cases.
- **Risk:** medium — changes which tasks count as "today". Consider gating
  behind the clinic-TZ column default so behaviour is explicit.
- **Rollback:** revert service; column is additive (safe to leave).

### PR-23 — DST / Asia-Jerusalem scheduling tests
- **Branch:** `cursor/scheduling-dst-tests`
- **Findings:** TZ-02.
- **Files:** `tests/appointments-scheduling.test.js`.
- **Changes:** add DST-transition and Asia/Jerusalem edge cases. Depends on
  PR-22.
- **Validation:** `pnpm test -- tests/appointments-scheduling.test.js`.
- **Risk:** low. **Rollback:** delete tests.

---

## Phase 8 — Error UX & API client

### PR-24 — Permanent sync-failure toast
- **Branch:** `cursor/sync-failure-ux`
- **Findings:** EU-01.
- **Files:** `src/lib/sync-engine.ts` (~L223-245).
- **Changes:** on max-retry permanent failure (currently only Sentry +
  Dexie `status: failed`), also fire a toast using the existing
  `t.layout.sync.failedMessage` key and link to the sync sheet.
- **Validation:** manual offline retry-exhaustion shows the toast.
- **Risk:** low. **Rollback:** revert.

### PR-25 — Route raw `fetch()` through the API client
- **Branch:** `cursor/api-client-unify`
- **Findings:** CD-03.
- **Files:** `src/hooks/use-auth.tsx` (`/api/users/me`, `/api/users/sync`),
  `src/lib/sync-engine.ts` (~L274), `src/pages/app-tour.tsx` (~L41).
- **Changes:** route raw `fetch()` calls through `request()` in
  `src/lib/api.ts` so they get the offline queue / 401 guard — or document
  each as an explicit, justified exception (auth bootstrap may legitimately
  bypass the client). Per-file commits.
- **Validation:** auth + sync offline tests pass.
- **Risk:** medium — auth bootstrap ordering is sensitive. **Rollback:**
  per-file revert.

---

## Phase 9 — Performance

### PR-26 — SSE load harness / soak documentation
- **Branch:** `cursor/sse-load-harness`
- **Findings:** PF-01.
- **Files:** new `load/` k6 script **or** a documented manual soak procedure.
- **Changes:** provide a way to exercise the ≥50-connects/5s storm-hint
  threshold; keep it out of the PR gate (nightly/manual).
- **Validation:** script runs locally against a dev server.
- **Risk:** low. **Rollback:** delete script/doc.

### PR-27 — Profile & fix N+1 on hot list routes
- **Branch:** `cursor/hot-route-n1`
- **Findings:** PF-02.
- **Files:** equipment list + ER board route/service handlers.
- **Changes:** profile the equipment list and ER board; replace per-row
  queries with selective joins where an N+1 is confirmed. **Investigate
  first** — no change if not reproduced.
- **Validation:** query-count assertion or before/after timing.
- **Risk:** medium. **Rollback:** revert handler.

---

## Phase 10 — Section D flow-verification specs (one PR per flow group)

Each PR adds Playwright/API specs under `tests/e2e/flows/`, following existing
stubs (`api-health.spec.ts`, `auth-gates.spec.ts`, `equipment-read.spec.ts`).
Test-only — risk low, rollback = delete spec.

### PR-28 — Code Blue session E2E
- **Branch:** `cursor/e2e-code-blue` · **Flows:** CB-01…CB-04.
- Start → log → end with SSE-confirmed end; offline attempt shows block toast
  and is never queued. Respect Code Blue doctrine — no optimistic termination.

### PR-29 — Equipment scan lifecycle E2E
- **Branch:** `cursor/e2e-equipment-lifecycle` · **Flows:** EQ-04…EQ-08.
- Scan → checkout → return → optional `seen` billing; offline queue behaviour.

### PR-30 — Medication complete path E2E
- **Branch:** `cursor/e2e-medication` · **Flows:** MED-01…MED-03.
- Take → complete with volume validation; post-hoc `vt_inventory_jobs` row
  visibility (async skew tolerated).

### PR-31 — Dispense authority + restock session E2E
- **Branch:** `cursor/e2e-inventory` · **Flows:** INV-02, INV-03.
- Enforce-mode `ORPHAN_DISPENSE_BLOCKED` vs shadow; restock session
  start→scan→finish.

### PR-32 — Ward display + SSE resync E2E
- **Branch:** `cursor/e2e-display-sse` · **Flows:** DISP-01, RT-01, RT-02.
- Snapshot render after a simulated `Last-Event-ID` gap / prune. Reuse the
  Phase 9 drill harness; do not alter the realtime transport.

### PR-33 — Billing read / leakage E2E
- **Branch:** `cursor/e2e-billing` · **Flows:** BIL-01, BIL-03.

### PR-34 — Scheduling task CRUD E2E
- **Branch:** `cursor/e2e-scheduling` · **Flows:** SCH-01…SCH-03.

### PR-35 — Pending / blocked account gate E2E
- **Branch:** `cursor/e2e-auth-gates` · **Flows:** AUTH-03, AUTH-04.
- Full-screen gate vs API 403 (`ACCOUNT_PENDING_APPROVAL` /
  `ACCOUNT_BLOCKED`).

### PR-36 — Admin + ER assign/handoff E2E
- **Branch:** `cursor/e2e-admin-er` · **Flows:** ADM-01, ADM-02, ER-02…ER-04.

---

## Phase 11 — Documentation

### PR-37 — Engineering / release docs
- **Branch:** `cursor/docs-release-process`
- **Findings:** CD-04, CD-05, DP-05, DP-06, TI-03, AU-03, AU-05, IB-01, SE-07.
- **Files:** `CONTRIBUTING.md` (new or updated), `TEST_AUDIT.md`-style notes,
  relevant `docs/`.
- **Changes:** document the `main` vs `staging` tooling/promotion process; the
  vitest default exclusions and the required manual/DB jobs per release;
  `RAILWAY_USE_CLI_DEPLOY`; Redis-required-in-prod checklist; dev auth headers
  (E2E only, never prod); role alias normalization; async inventory skew;
  `SMART_COP_VALIDATION_FAIL_OPEN` ops guidance.
- **Risk:** none. **Rollback:** revert.

### PR-38 — Branch-protection documentation
- **Branch:** `cursor/docs-branch-protection`
- **Findings:** Section B branch-protection audit.
- **Files:** new `docs/infra/branch-protection.md`.
- **Changes:** template doc capturing the expected required checks for `main`
  and `staging`; to be filled from an admin export (API returned 403 / empty
  rulesets during the audit).
- **Risk:** none. **Rollback:** revert.

### PR-39 — ER handoff role-denial regression test
- **Branch:** `cursor/er-handoff-denial-test`
- **Findings:** AU-02 follow-up. Depends on PR-10.
- **Files:** `tests/*er*hardening*` or new test.
- **Changes:** lock the ack-route 403 behaviour with a regression test.
- **Risk:** none. **Rollback:** delete test.

---

## Operations follow-ups (no code — excluded from the PR catalog)

These appear in the registers but require GitHub/Railway/Clerk dashboard
access and cannot be done from this repo:

- **SE-01** — Clerk live-key rotation (`docs/runbooks/1.4-clerk-key-rotation.md`).
- **Section B** — Railway env redacted-diff review; worker-heartbeat / Redis
  fix (readiness 503 on both envs); pruning of merged `cursor/*`/`claude/*`
  remote branches; controlled `staging → main` reconciliation (7/7 diverged);
  open-PR triage (#355 merge, #308/#283 rebase-or-close, #358 conflicts);
  branch-protection ruleset export; Railway health-check path alignment.
- **SE-07** — keep `SMART_COP_VALIDATION_FAIL_OPEN=false` in prod (config).

## Cross-cutting execution notes

- **Schema changes** (PR-20, PR-22): edit `server/db.ts`, then
  `npx drizzle-kit generate`, commit the generated SQL; the runtime applies it
  via `runMigrations()` at startup. Every query stays `clinicId`-scoped.
- **i18n** (PR-13, PR-14): keys in both `locales/he.json` + `locales/en.json`
  (parity enforced); run `scripts/i18n/generate-types.ts`; access via typed
  `t.*`.
- **New audit kinds** (if any guard logs audit): add to the closed
  `AuditActionType` union in `server/lib/audit.ts`.
- Every PR ends with `npx tsc --noEmit` zero errors and the named tests green.

## Verification (whole effort)

1. Each PR: `npx tsc --noEmit` clean + named tests pass + Conventional Commit.
2. After PR-03, every subsequent PR into `staging` is gated by `ci.yml`.
3. Realtime/PWA-adjacent PRs (PR-32) also run the Playwright Phase 9 drills.
4. PR-20 and PR-22 additionally run the DB-integration suites (require
   `DATABASE_URL` + applied migrations).
5. Final: `staging` is green on CI + Playwright; no frozen-surface regressions.

## Immediate deliverable for this branch

On `claude/vettrack-audit-section-f-KcpAN` (created from `origin/staging`):
commit **PR-01** — `BUG_REGISTER.md`, `FLOW_MATRIX.md`, `INFRA_CLEANUP_PLAN.md`,
and `IMPLEMENTATION_PLAN.md` (this plan) — and push. PR-02…PR-39 are then
executed by Cursor Composer 2.5, each branched from `origin/staging`.

## Phase 10 status correction (post-implementation)

The Phase 10 commits in PR #366 (PR-28 through PR-36) ship as **API smoke tests**, not the multi-step flows described in `FLOW_MATRIX.md`. Each spec asserts that a primary GET or POST returns a non-5xx status; offline behavior, SSE replay, mutation chains, and UI gates are NOT covered.

| PR | What ships | What's deferred |
|----|------------|-----------------|
| PR-28 | Code Blue active session GET 200 | start/log/end mutations, offline block, SSE-confirmed end |
| PR-29 | Equipment scan checkout/return API | offline queue, billing seen propagation |
| PR-30 | Medication tasks list GET 200 | take/complete, volume validation, inventory job |
| PR-31 | Dispense empty-body 4xx (not 500) | enforce vs shadow authority, restock session |
| PR-32 | Display snapshot GET | SSE Last-Event-ID gap / replay |
| PR-33 | Billing ledger GET 200 | leakage write flows |
| PR-34 | Appointments + tasks/me GET | CRUD, clinic-TZ boundary E2E |
| PR-35 | /api/users/me 200 under dev-bypass | pending/blocked account 403 + UI gate (AUTH-03/04) — superseded by H2 rewrite (see PR #366 follow-up) |
| PR-36 | ER board GET 200 | assign/handoff mutations, admin flows |

Full flow coverage tracked in follow-up issues `#TBD-FLOW-1` through `#TBD-FLOW-9` (to be opened after merge — one per deferred row). Replace `#TBD-FLOW-N` placeholders with real issue numbers once filed.
