# VetTrack Scaling Implementation Program

**Status:** Executable program v2.0 (living production environment)  
**Audience:** Engineering leads, PR authors, reviewers  
**Assumptions:** Production VetTrack; existing users/data; offline-first + sync + realtime frozen where documented; feature work never stops; **two other implementation programs already consume capacity**.

---

## Active programs (do not plan in a vacuum)

| Track | Source doc | Scope | Typical touch zones |
|-------|------------|--------|---------------------|
| **Track AUDIT** | `IMPLEMENTATION_PLAN.md` | PR-01…PR-39: CI/workflows, i18n, Zod `.strict()`, equipment **version OCC** (PR-18), timezone on appointments (PR-22), sync UX (PR-24/25), inventory CHECK (PR-20), flow E2E smokes (PR-28…36), docs | `.github/workflows/*`, `server/routes/equipment.ts`, `appointments.service.ts`, `sync-engine.ts`, `api.ts`, `locales/*`, `server/db.ts` migrations |
| **Track OFFLINE** | `docs/offline-first-architecture-plan.md` | Phases 1…11: registry hard-fail, Dexie queue fields, replay idempotency, conflict persistence, operator DLQ UX, emergency CI gate, observability, reconciliation, Playwright offline drills | `offline-mutation-registry.ts`, `offline-policy.ts`, `offline-db.ts`, `sync-engine.ts`, `api.ts`, equipment routes, **no medication offline** |
| **Track SCALE** | This document | SP-A-01…SP-G-08: boundaries, contracts, clinical guardrails, observability, hardening | Overlaps all of the above |

**Satellite work (not a third program, but collides):** Phase 10 stabilization fixes (`docs/validation/phase-10-stabilization-report.md`), Stream B audit items (`docs/superpowers/plans/2026-04-28-stream-b-audit-plan-remaining.md`), Smart COP Phase 3 wiring — treat as **feature/fix lanes** that preempt SCALE PRs touching the same files.

### Capacity model (realistic)

Assume at any time:

- **40–60%** engineering capacity → Track AUDIT + Track OFFLINE (in flight, staggered PRs)
- **20–30%** → product/features (unplanned merges)
- **10–20%** → Track SCALE (this roadmap)

**Rule:** Max **2 SCALE PRs open** per squad; max **1** touching `equipment.ts` / `sync-engine.ts` / `appointments.service.ts` at once. PRs may sit open **3–10 days** — plan for rebase churn.

### Parallelization legend (required on every SCALE PR)

| Status | Meaning |
|--------|---------|
| **Safe parallel** | Different files/owners; no semantic dependency on in-flight AUDIT/OFFLINE PRs |
| **Partial parallel** | Can start in parallel but must rebase/coordinate before merge; or doc-only while code lands elsewhere |
| **Sequential only** | Must merge after named track PR/phase or SCALE PR; merge conflict or behavior change too likely |

Full per-PR status: **Appendix A** (end of document).

---

## Program principles

1. **No rewrite, no big-bang** — each PR is revertable; production deployable every merge.
2. **Behavior preservation** — characterization tests before moves; shadow before enforce.
3. **Frozen surfaces** — SSE/outbox transport, BroadcastChannel envelope, PWA build-tag denylist, emergency offline block, Strategy A authority, `appointmentsPage.*` keys, closed telemetry enums: **extend only**, do not replace.
4. **Ugly middle** — temporary re-export shims, duplicate wrappers, and dual import paths are **expected** for 2–4 months.
5. **Clinical gate** — Tier-3 PRs need two reviewers from Platform + Domain owners (once CODEOWNERS lands).

## Execution order (ROI)

Run waves **mostly in sequence** (A→B→…→G), but **within a wave** parallelize by ownership. **Quick wins** marked ⚡ can ship in week 1 alongside Wave A.

| Priority | Waves / themes |
|----------|----------------|
| **High** | A (gates), D (offline registry), C (clinical characterization), E (contracts top mutations), B (appointments/medication commands) |
| **Medium** | F (observability), B (equipment route thinning), E (full contract catalog) |
| **Low** | G (hardening polish, load tests, module READMEs) |

## Estimated program duration

**6–10 months** for Track SCALE at **10–20% capacity** alongside AUDIT + OFFLINE (not 4–7 months at full-team focus). **60–62 SCALE PRs** after splits. Calendar expands when:

- AUDIT PR-18/22 touch the same god files as SCALE Wave B
- OFFLINE Phase 3+ blocks SCALE Wave D
- Feature interrupts freeze Wave B for weeks

---

# Coordination impact (living environment)

### Likely merge hotspots (rebase daily if touching)

| Hotspot | Why |
|---------|-----|
| `server/routes/equipment.ts` (~2800 LOC) | AUDIT PR-18 (OCC), OFFLINE Phases 4–5, SCALE SP-B-07/08/G-02, features |
| `src/lib/sync-engine.ts` | AUDIT PR-24/25, OFFLINE Phases 5–9, SCALE SP-D-02/F-04 |
| `src/lib/api.ts` | AUDIT PR-25, OFFLINE registry tests, every feature API |
| `server/services/appointments.service.ts` | AUDIT PR-17/22, SCALE SP-B-02/03, scheduling features |
| `server/services/medication-tasks.service.ts` | AUDIT PR-15/30, SCALE SP-B-04/C-02, clinical features |
| `.github/workflows/ci.yml` | AUDIT PR-02–07, SCALE SP-A-05/E-08 |
| `locales/en.json` + `he.json` | AUDIT PR-13/14/21, OFFLINE Phase 6, SCALE SP-D-04 |
| `server/db.ts` + `migrations/` | AUDIT PR-20/22, OFFLINE Phase 3, Stream B 076, SCALE SP-F-06 |

### Ownership bottlenecks

- **Platform guild** (once SP-A-07): outbox, CI, auth — becomes reviewer choke point if not staffed.
- **Offline track owner**: gates all SCALE Wave D merges after OFFLINE Phase 2.
- **Clinical safety reviewer**: medication + dispense PRs queue behind AUDIT PR-15 and Smart COP work.

### Shared files that become dangerous

- `src/lib/offline-mutation-registry.ts` — OFFLINE Phase 1–2 **owns**; SCALE SP-D-01 only adds changelog, does not change policy.
- `src/lib/offline-policy.ts` — OFFLINE owns; SCALE **must not** duplicate gate logic.
- `server/lib/realtime-outbox.ts` + `server/routes/realtime.ts` — SCALE SP-E-03/F-03 ❄️; AUDIT PR-32 touches client replay tests only.

### Migration collision risks

| Migration concern | Tracks |
|-------------------|--------|
| `vt_equipment.version` semantics | AUDIT PR-18 before SCALE equipment command extraction |
| Dexie v4→v5+ queue fields | OFFLINE Phase 3 **before** SCALE SP-D-08 |
| `vt_clinics.timezone` | AUDIT PR-22 **before** SCALE SP-B-03b scheduling commands |
| `vt_clinic_feature_config` | SCALE SP-F-06 after AUDIT PR-20 stable |
| Code Blue reconciliation cols | Stream B 076 — avoid SCALE touching `code-blue.ts` same week |

### CI / test bottlenecks

- Playwright wall-clock (AUDIT PR-07 sharding) — SCALE ❄️ PRs queue behind drill runs.
- `DATABASE_URL` integration tests — serialize PR-20, SP-C-02, SP-G-06 to avoid migration fights.
- Vitest already 200+ files — **do not** add 50 contract tests in one PR; spread per SP-E-01.

### Temporary duplicated logic risk

| Duplication | Duration | Accept? |
|-------------|----------|---------|
| Appointment logic in `appointments.service.ts` + `appointments/commands/*` | 2–4 months | Yes — shim period |
| Idempotency: billing keys (SCALE SP-C-03) + OFFLINE Phase 4 equipment keys | Permanent but layered | Yes — different domains |
| Registry policy in tests (OFFLINE) + changelog doc (SCALE SP-D-01) | Until OFFLINE Phase 2 merges | Yes |
| Error codes in `shared/` (SCALE SP-E-02) + phase-5 error tests (AUDIT) | 1 month overlap | Yes — align in SP-E-02 PR description |

---

# Roadmap conflict matrix

| SCALE PR | Conflicts with | Why | Mitigation |
|----------|----------------|-----|------------|
| SP-A-04 | — | Read-only architecture tests | Safe parallel |
| SP-A-05a/b | AUDIT PR-02–07 | Same `ci.yml` | One CI PR at a time; AUDIT owns workflow until PR-07 merged |
| SP-A-10 | AUDIT PR-15 | Routes + services scan | Report-only until AUDIT strict rollout stable |
| SP-B-01–04 | AUDIT PR-17, PR-22, PR-30 | `appointments.service.ts` / medication | **Sequential:** B-03a after PR-17; B-03b after PR-22; B-04 after PR-30 smoke; C-01 can parallel B-04 if tests-only |
| SP-B-07–08 | AUDIT PR-18, OFFLINE Ph 4–5 | `equipment.ts` rewrite | **Sequential:** B-07 after PR-18 merged; B-08 after OFFLINE Phase 2 |
| SP-C-02 | AUDIT PR-15, PR-20 | medication + inventory schema | After PR-15 strict schemas; do not run with PR-20 same sprint |
| SP-D-01 | OFFLINE Phase 1 | Registry changelog | Partial — doc only; do not change registry |
| SP-D-02 | OFFLINE Phase 2, AUDIT PR-24 | sync-engine semantics | **After** OFFLINE Phase 2 + PR-24 |
| SP-D-03 | OFFLINE Phase 4 | Idempotency story | **After** OFFLINE Phase 4; else duplicate spec |
| SP-D-04 | OFFLINE Phase 6 | Sync sheet i18n | **After** OFFLINE Phase 6 or merge copy |
| SP-D-05 | AUDIT PR-32, OFFLINE Phase 9 | Reconciliation hooks | Partial — doc now; code after OFFLINE Phase 9 |
| SP-D-07 | OFFLINE Phase 7 | Emergency parity CI | Coordinate — one emergency gate PR |
| SP-D-08 | OFFLINE Phase 3 | Dexie version | **After** OFFLINE Phase 3 |
| SP-E-01 | AUDIT PR-17, PR-18 | Contract fixtures on appointments/equipment | Extend fixtures when AUDIT PRs land |
| SP-E-03 | — | Outbox types | Partial parallel; ❄️ review |
| SP-E-08 | AUDIT PR-02–05 | CI test list | Merge with AUDIT or append only |
| SP-F-04 | AUDIT PR-24, OFFLINE Phase 8 | sync telemetry | **After** both |
| SP-F-06 | AUDIT PR-22 | clinic config JSONB | Design together; one migration window |
| SP-G-02 | SP-B-08, AUDIT PR-18 | equipment routes | Last in chain |
| SP-G-04 | AUDIT PR-26 | SSE load harness | **Defer** — use AUDIT PR-26; close SP-G-04 as duplicate |
| SP-C-09 | Smart COP / enforce rollout | Per-clinic enforce | Monthly guild; never race OFFLINE hard-fail rollout |

---

## Revised wave sequencing (with tracks)

| Wave | Start when | Blocked by |
|------|------------|------------|
| **A** | Immediately | CI file: yield to AUDIT PR-02–05 if open |
| **B** | A done + AUDIT PR-17 merged | PR-18 before equipment split; PR-22 before appointment commands |
| **C** | B-01 + characterization (parallel AUDIT) | PR-15 before C-02 |
| **D** | OFFLINE Phase 2 merged | Phases 3–4 before D-03/D-08; PR-24 before D-02 |
| **E** | C-01 + AUDIT PR-17/18 fixtures | — |
| **F** | E-03 + OFFLINE Phase 8 | PR-26 supersedes G-04 |
| **G** | B complete + OFFLINE Phase 5 | Equipment chain last |

---

## Catalog keys

| Tag | Meaning |
|-----|---------|
| ⚡ | Quick win |
| 🔴 | High-risk PR |
| 👻 | Requires shadow mode period before enforce |
| 🚩 | Feature flag or per-clinic config |
| 🗄️ | DB migration |
| 📦 | Multi-release rollout |
| ❄️ | Touches frozen surfaces (extra review + Phase 9 drills) |
| 🗃️ | Migration script / backfill |

---

# Wave A — Foundations

**Why now:** Without ownership maps, CI gates, and inventories, later refactors duplicate rules and break tenancy/offline silently.  
**Why not earlier:** N/A — start here.  
**Production risk removed:** Unowned changes, silent worker/route omissions, unreviewed clinical PRs.  
**Track overlap:** Mostly **safe parallel** with AUDIT PR-01/37/38 (docs) and OFFLINE Phase 1 (tests-only). **Avoid** editing `ci.yml` while AUDIT PR-02–07 open.

---

### SP-A-01 — Publish scaling program + bounded context map ⚡

**Parallelization:** **Safe parallel** — docs only; update v2.0 program + `bounded-context-map.md`. Does not conflict with AUDIT/OFFLINE code paths.

| Field | Value |
|-------|-------|
| **Goal** | Single source of truth for this program and domain seams |
| **Scope** | Add `docs/scaling-implementation-program.md`, `docs/bounded-context-map.md` (tables: context, owns, folders, writers, events, offline allowlist keys) |
| **Files** | `docs/*`, link from `README.md`, `CLAUDE.md` (one paragraph) |
| **Non-goals** | Code moves, schema changes |
| **Depends on** | — |
| **Acceptance** | Every row in context map points to real paths; reviewed by lead |
| **Risks** | Doc drift | **Rollback** | Revert docs |
| **Tests** | None | **Difficulty** | Small |

---

### SP-A-02 — CODEOWNERS + review tier labels ⚡

**Parallelization:** **Safe parallel** — may merge before AUDIT PR-37 if paths align with real folders.

| Field | Value |
|-------|-------|
| **Goal** | GitHub auto-request reviewers by domain |
| **Scope** | `.github/CODEOWNERS`, `.github/pull_request_template.md` (Tier 1/2/3 checklist, frozen surface checkbox) |
| **Files** | `.github/*` |
| **Non-goals** | Branch protection rules (ops follow-up) |
| **Depends on** | SP-A-01 |
| **Acceptance** | Sample PR assigns `@platform` + `@medication` on `medication-tasks.service.ts` touch |
| **Risks** | Wrong paths → no reviews | **Rollback** | Revert CODEOWNERS |
| **Tests** | None | **Difficulty** | Small |

---

### SP-A-03 — ADR template + first ADRs ⚡

**Parallelization:** **Safe parallel**.

| Field | Value |
|-------|-------|
| **Goal** | Decision trail for shadow→enforce, async inventory, offline registry |
| **Scope** | `docs/adr/000-template.md`, `001-command-query-split.md`, `002-offline-registry-constitution.md`, `003-evaluator-rollout.md` |
| **Files** | `docs/adr/*` |
| **Non-goals** | Implementing ADR content |
| **Depends on** | SP-A-01 |
| **Acceptance** | ADRs linked from bounded context map |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | None | **Difficulty** | Small |

---

### SP-A-04 — Route + scheduler registration guard test ⚡

**Parallelization:** **Safe parallel** — complements AUDIT PR-04/06; no file conflict.

| Field | Value |
|-------|-------|
| **Goal** | Fail CI if new `server/routes/*.ts` or `server/workers/*.ts` not registered |
| **Scope** | `tests/architecture/route-registration.test.ts`, `tests/architecture/scheduler-registration.test.ts` (glob vs `server/app/routes.ts`, `start-schedulers.ts`) |
| **Files** | `tests/architecture/*`, `server/app/routes.ts`, `server/app/start-schedulers.ts` |
| **Non-goals** | Changing registrations |
| **Depends on** | — |
| **Acceptance** | Deliberately unmounted fixture fails test; full suite green |
| **Risks** | False positive on intentional exclusions | **Rollback** | Revert tests |
| **Tests** | New architecture tests | **Difficulty** | Small |

---

### SP-A-05a — Knip baseline script + report-only CI ⚡

**Parallelization:** **Partial parallel** — add script without failing CI; **do not** edit `ci.yml` if AUDIT PR-02–05 open (coordinate in #platform channel).

| Field | Value |
|-------|-------|
| **Goal** | Visible knip debt baseline before enforcement |
| **Scope** | `package.json` `knip`, `knip.json` allowlist for current debt, CI step `continue-on-error` |
| **Files** | `package.json`, `knip.json`, optionally `.github/workflows/ci.yml` |
| **Non-goals** | Failing CI on legacy debt |
| **Depends on** | — |
| **Acceptance** | Knip runs in CI; artifact uploaded; zero new allowlist entries without justification |
| **Risks** | Low | **Rollback** | Remove step |
| **Tests** | CI | **Difficulty** | Small |

---

### SP-A-05b — Knip fail on new dead exports

**Parallelization:** **Sequential only** — after SP-A-05a **and** AUDIT PR-03/05 CI churn settled.

| Field | Value |
|-------|-------|
| **Goal** | Block new orphan exports during Wave B splits |
| **Scope** | Tighten CI to fail on delta vs baseline file `knip-baseline.json` |
| **Files** | `.github/workflows/ci.yml`, `scripts/knip-delta.ts` |
| **Non-goals** | Burning down full baseline (SP-G-07) |
| **Depends on** | SP-A-05a, AUDIT PR-05 |
| **Acceptance** | PR adding unused export fails CI |
| **Risks** | 🔴 Flaky if baseline not updated correctly | **Rollback** | Revert to 05a |
| **Tests** | CI | **Difficulty** | Medium |

---

### SP-A-06 — Transaction entry point inventory (medication + billing)

**Parallelization:** **Partial parallel** — doc/test only; update inventory when AUDIT PR-15 touches routes.

| Field | Value |
|-------|-------|
| **Goal** | Document only functions allowed to open `db.transaction` for clinical/financial writes |
| **Scope** | `docs/seams/transaction-entry-points.md`, `tests/architecture/transaction-entry-points.test.ts` (static allowlist of file:function) |
| **Files** | `docs/seams/*`, `tests/architecture/*`, grep `medication-tasks`, `appointments`, `billing` |
| **Non-goals** | Refactoring transactions |
| **Depends on** | SP-A-01 |
| **Acceptance** | Inventory matches grep; test fails if new `db.transaction` in routes/ |
| **Risks** | Incomplete inventory | **Rollback** | Revert test |
| **Tests** | Architecture test | **Difficulty** | Medium |

---

### SP-A-07 — Platform guild charter + escalation

| Field | Value |
|-------|-------|
| **Goal** | Named owners for schema, auth, outbox publisher, sync shell, CI |
| **Scope** | `docs/team/platform-guild.md`, update `docs/engineering-rules-rollout.md` |
| **Files** | `docs/team/*` |
| **Non-goals** | Org chart changes |
| **Depends on** | SP-A-02 |
| **Acceptance** | On-call rotation doc links platform guild for outbox/sync incidents |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | None | **Difficulty** | Small |

---

### SP-A-08 — Clinical PR checklist in CI comment bot (optional) or template only

| Field | Value |
|-------|-------|
| **Goal** | Standard questions: tenancy, offline registry, audit kind, outbox, i18n |
| **Scope** | `.github/pull_request_template.md` Tier-3 section; optional `scripts/pr-checklist-lint.ts` |
| **Files** | `.github/*` |
| **Non-goals** | Automated enforcement of all items |
| **Depends on** | SP-A-02 |
| **Acceptance** | Template visible on new PRs |
| **Risks** | Checkbox fatigue | **Rollback** | Revert template |
| **Tests** | None | **Difficulty** | Small |

---

### SP-A-09 — `docs/contracts/` scaffold + contract test harness ⚡

| Field | Value |
|-------|-------|
| **Goal** | Directory for golden JSON fixtures + shared test helper |
| **Scope** | `docs/contracts/README.md`, `tests/contracts/_harness.ts`, `tests/contracts/.gitkeep` |
| **Files** | `docs/contracts/*`, `tests/contracts/*` |
| **Non-goals** | Full OpenAPI |
| **Depends on** | — |
| **Acceptance** | `pnpm test` runs empty contract suite |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | Harness smoke | **Difficulty** | Small |

---

### SP-A-10 — Tenancy static check (grep-based CI) ⚡

| Field | Value |
|-------|-------|
| **Goal** | Fail if new `server/routes/*.ts` or `server/services/*.ts` uses `.from(` without nearby `clinicId` pattern (heuristic) |
| **Scope** | `scripts/lint-tenancy-heuristic.ts`, wire in CI (report-only → enforce) |
| **Files** | `scripts/*`, `.github/workflows/ci.yml` |
| **Non-goals** | Proof of correctness |
| **Depends on** | — |
| **Acceptance** | Known-good baseline; new route without `clinicId` fails |
| **Risks** | 🔴 False positives on global tables | **Rollback** | report-only mode |
| **Tests** | Script unit test | **Difficulty** | Medium |

---

**Wave A ugly middle:** Knip and tenancy lint in **report-only** until Wave B starts (2 weeks).

---

# Wave B — Boundaries and ownership

**Why now:** God files (`appointments.service.ts` ~2177 LOC, `equipment.ts` route ~2823 LOC) block parallel teams.  
**Why not earlier:** Need CODEOWNERS + transaction inventory (Wave A).  
**Production risk removed:** Merge conflicts, accidental cross-domain imports, circular deps.  
**Track overlap:** **Assume Wave B is often blocked** — AUDIT PR-17/18/22 and OFFLINE Phase 2–4 take precedence. Schedule **one** god-file PR open at a time.

**Hidden problems targeted:** God services, circular dependencies, duplicate business rules, missing ownership.

---

### SP-B-01 — Create `server/services/appointments/` package (shim re-exports) 🔴

**Parallelization:** **Partial parallel** — safe if AUDIT PR-22 not editing same file; **sequential** if PR-22 open.

| Field | Value |
|-------|-------|
| **Goal** | Folder exists; **zero behavior change** via re-export barrel |
| **Scope** | `server/services/appointments/index.ts` re-exports from `../appointments.service.ts` |
| **Files** | `server/services/appointments/*`, `server/services/appointments.service.ts` (unchanged logic) |
| **Non-goals** | Moving implementations |
| **Depends on** | SP-A-01, SP-A-06 |
| **Acceptance** | All imports work via old path; `tsc` clean; characterization tests pass |
| **Risks** | 🔴 Missed import paths | **Rollback** | Remove folder |
| **Tests** | `pnpm test` + `tests/appointment-datetime-contract.test.ts` | **Difficulty** | Medium |

---

### SP-B-02 — Extract appointments **queries** (read-only)

| Field | Value |
|-------|-------|
| **Goal** | Read paths in `appointments/queries/*.ts` |
| **Scope** | Move list/get/search functions; leave mutations in legacy file |
| **Files** | `server/services/appointments/queries/*`, routes importing queries |
| **Non-goals** | Transaction changes |
| **Depends on** | SP-B-01 |
| **Acceptance** | Same API responses; contract tests if exist |
| **Risks** | 🔴 Subtle filter/tenancy drift | **Rollback** | Revert move |
| **Tests** | Appointment tests, tenancy spot check | **Difficulty** | Large |

---

### SP-B-03a — Extract appointments commands (create/update only) 📦

**Parallelization:** **Sequential only** — after **AUDIT PR-17** merged (datetime contract). Not parallel with PR-22.

| Field | Value |
|-------|-------|
| **Goal** | Create/update mutations in `appointments/commands/` |
| **Scope** | `parseAppointmentInstant` stays exported; no timezone logic change |
| **Files** | `server/services/appointments/commands/*`, routes |
| **Non-goals** | Cancel flows; clinic TZ |
| **Depends on** | SP-B-02, AUDIT PR-17 |
| **Acceptance** | `tests/appointment-datetime-contract.test.ts` green |
| **Risks** | 🔴 Datetime regression | **Rollback** | Revert |
| **Tests** | Appointment contract tests | **Difficulty** | Large |

---

### SP-B-03b — Extract appointments commands (cancel/day boundaries) 📦

**Parallelization:** **Sequential only** — after **AUDIT PR-22** (clinic timezone column + today boundaries).

| Field | Value |
|-------|-------|
| **Goal** | Cancel + day-boundary queries use clinic TZ from PR-22 |
| **Scope** | Move `getTasksForTechnicianToday` / `getAppointmentsByDay` with PR-22 semantics |
| **Files** | `appointments/commands/*`, `appointments/queries/*` |
| **Non-goals** | Medication tasks |
| **Depends on** | SP-B-03a, AUDIT PR-22 |
| **Acceptance** | `tests/appointments-scheduling.test.js` green |
| **Risks** | 🔴 Wrong “today” task set | **Rollback** | Revert |
| **Tests** | Scheduling + TZ tests | **Difficulty** | Large |

---

### SP-B-04 — Medication tasks folder + shim (`medication-tasks/`) 🔴

**Parallelization:** **Sequential only** — after SP-B-03a; not while AUDIT PR-15 (Zod strict) or PR-30 (med E2E) in review.

| Field | Value |
|-------|-------|
| **Goal** | Mirror appointments pattern for `medication-tasks.service.ts` (~755 LOC) |
| **Scope** | `commands/complete-task.ts`, `commands/create-task.ts`, `queries/open-tasks.ts` |
| **Files** | `server/services/medication-tasks/*` |
| **Non-goals** | Changing dose formulas |
| **Depends on** | SP-A-06, SP-B-03a |
| **Acceptance** | `completeTask` still one transaction with billing + outbox per inventory doc |
| **Risks** | 🔴 **Highest clinical risk in Wave B** | **Rollback** | Revert |
| **Tests** | `tests/medication-dedup-hardening.test.ts`, `tests/phase-2-3-medication-package-integration.test.ts` (if DB), medication helpers | **Difficulty** | Very Large |

---

### SP-B-05 — Port modules: `server/ports/billing.port.ts`, `clinical.port.ts`

| Field | Value |
|-------|-------|
| **Goal** | Cross-context calls go through ports (interfaces + thin adapters) |
| **Scope** | Medication completion calls billing via port, not direct import of billing internals |
| **Files** | `server/ports/*`, `medication-tasks/commands/*` |
| **Non-goals** | New microservices |
| **Depends on** | SP-B-04 |
| **Acceptance** | knip no new cycles; `tests/architecture/import-layer.test.ts` |
| **Risks** | Circular dependency surfaced — fix before merge | **Rollback** | Revert ports |
| **Tests** | Import layer test | **Difficulty** | Large |

---

### SP-B-06 — `shared/` audit: contract vs non-contract split ⚡

| Field | Value |
|-------|-------|
| **Goal** | Tag each `shared/*.ts` as CONTRACT or INTERNAL; move INTERNAL out over time |
| **Scope** | `docs/seams/shared-ownership.md`, `tests/architecture/shared-contract.test.ts` (only listed files importable from client) |
| **Files** | `shared/*`, `docs/seams/*` |
| **Non-goals** | Moving files yet |
| **Depends on** | SP-A-01 |
| **Acceptance** | Test fails if server-only code imported from `src/` incorrectly |
| **Risks** | None | **Rollback** | Revert test |
| **Tests** | Architecture test | **Difficulty** | Medium |

---

### SP-B-07 — Equipment routes: extract handlers file 1/N (read endpoints)

| Field | Value |
|-------|-------|
| **Goal** | Begin splitting `server/routes/equipment.ts` (~2823 LOC) |
| **Scope** | `server/routes/equipment/handlers/list.ts`, wire router |
| **Files** | `server/routes/equipment.ts` → `server/routes/equipment/*` |
| **Non-goals** | Scan/checkout mutation logic changes |
| **Depends on** | SP-A-04 |
| **Acceptance** | Equipment list API identical; offline registry unchanged |
| **Risks** | 🔴 Merge conflict magnet | **Rollback** | Revert split |
| **Tests** | Offline registry tests, equipment tests if any | **Difficulty** | Large |

---

### SP-B-08 — Equipment routes: extract mutations 2/N (checkout/return)

**Parallelization:** **Sequential only** — after **AUDIT PR-18** (version OCC) **and** **OFFLINE Phase 2** (registry hard-fail). Highest merge conflict PR in program.

| Field | Value |
|-------|-------|
| **Goal** | Isolate scan/checkout/return handlers |
| **Scope** | Handlers call existing services; no business rule edits |
| **Files** | `server/routes/equipment/*`, `server/services/inventory.service.ts` |
| **Non-goals** | Offline policy changes |
| **Depends on** | SP-B-07, SP-D-02 |
| **Acceptance** | `tests/offline-mutation-registry.test.ts` green |
| **Risks** | 🔴 Offline producer path drift | **Rollback** | Revert |
| **Tests** | Offline registry + conflict tests | **Difficulty** | Very Large |

---

### SP-B-09 — ER wedge folder consolidation

| Field | Value |
|-------|-------|
| **Goal** | `server/services/er/` owns intake, handoff, board, escalation imports |
| **Scope** | Move `er-*.service.ts` behind index; update `server/routes/er.ts` |
| **Files** | `server/services/er/*`, `server/routes/er.ts` |
| **Non-goals** | ER Mode allowlist behavior change |
| **Depends on** | SP-B-05 |
| **Acceptance** | ER route tests pass; concealment 404 unchanged |
| **Risks** | Medium | **Rollback** | Revert |
| **Tests** | ER/handoff tests | **Difficulty** | Large |

---

### SP-B-10 — Deprecate direct imports of god files (eslint/tsc path rule)

| Field | Value |
|-------|-------|
| **Goal** | New code must import from `appointments/` package not `appointments.service.ts` |
| **Scope** | `tests/architecture/no-legacy-service-imports.test.ts` |
| **Files** | `tests/architecture/*` |
| **Non-goals** | Fixing all legacy imports |
| **Depends on** | SP-B-03b, SP-B-04 |
| **Acceptance** | CI fails on new violations only |
| **Risks** | None | **Rollback** | Disable test |
| **Tests** | Architecture test | **Difficulty** | Medium |

---

**Wave B ugly middle:** Dual import paths (barrel + legacy file) for **entire Wave C**. Do not delete `appointments.service.ts` until SP-G-02.

---

# Wave C — Clinical safety

**Why now:** Boundaries allow testing commands in isolation; characterization prevents formula drift during feature work.  
**Why not earlier:** Need command extraction targets and transaction inventory.  
**Production risk removed:** Wrong dose, orphan dispense, authority bypass, silent enforce.

---

### SP-C-01 — Medication dose characterization test suite ⚡👻

| Field | Value |
|-------|-------|
| **Goal** | Golden vectors for `volumeMl`, `MAX_SAFE_VOLUME_ML`, tablet path |
| **Scope** | `tests/clinical/medication-dose-vectors.test.ts` from `medication-calculation.service.ts` |
| **Files** | `tests/clinical/*`, `server/services/medication-calculation.service.ts` (export test hooks if needed) |
| **Non-goals** | Changing formulas |
| **Depends on** | SP-B-04 (preferred) or parallel if read-only |
| **Acceptance** | Vectors cover mcg, mEq, tablet 0.25 steps, boundary 99.99 vs 100 |
| **Risks** | None if no logic change | **Rollback** | Revert tests |
| **Tests** | New clinical tests | **Difficulty** | Medium |

---

### SP-C-02 — `completeTask` integration characterization 🔴

| Field | Value |
|-------|-------|
| **Goal** | Document expected side effects: billing row, inventory job, audit, outbox |
| **Scope** | `tests/clinical/complete-task-effects.test.ts` (mock DB or test DB) |
| **Files** | `server/services/medication-tasks/commands/*` |
| **Non-goals** | Async worker behavior |
| **Depends on** | SP-B-04, SP-A-06 |
| **Acceptance** | Assert idempotency key presence; job row enqueued |
| **Risks** | 🔴 Flaky DB tests | **Rollback** | Revert |
| **Tests** | Clinical integration | **Difficulty** | Large |

---

### SP-C-03 — Billing idempotency audit + test for top mutation paths

| Field | Value |
|-------|-------|
| **Goal** | Every billing insert path uses deterministic key |
| **Scope** | `tests/clinical/billing-idempotency.test.ts`, `docs/seams/billing-idempotency.md` |
| **Files** | `server/lib/equipment-seen.ts`, `appointments.service.ts`, medication completion |
| **Non-goals** | Schema change |
| **Depends on** | SP-A-06 |
| **Acceptance** | Duplicate insert returns existing row in test |
| **Risks** | 🔴 Double charge if wrong | **Rollback** | Revert |
| **Tests** | Idempotency tests | **Difficulty** | Medium |

---

### SP-C-04 — Evaluator rollout harness doc → code 👻🚩

| Field | Value |
|-------|-------|
| **Goal** | New evaluators must register default `shadow` in clinic config |
| **Scope** | `server/lib/authority/enforcement/_template.evaluator.ts`, test that wiring defaults to shadow |
| **Files** | `server/lib/authority/enforcement/*`, `tests/phase-5-pr-5-7-enforcement-rollout.test.ts` (extend) |
| **Non-goals** | New clinical rules |
| **Depends on** | SP-A-03 ADR-003 |
| **Acceptance** | Template evaluator in `off` only in tests |
| **Risks** | None | **Rollback** | Revert template |
| **Tests** | Enforcement rollout tests | **Difficulty** | Medium |

---

### SP-C-05 — Dispense / Smart COP golden tests (orphan reasons)

| Field | Value |
|-------|-------|
| **Goal** | Stable reason codes `NO_PATIENT_LINKED`, etc. |
| **Scope** | `tests/clinical/dispense-order-validation.test.ts` |
| **Files** | `server/lib/dispense-order-validation.ts` |
| **Non-goals** | Policy change enforce vs shadow |
| **Depends on** | SP-C-04 |
| **Acceptance** | Matches `CONTEXT.md` glossary |
| **Risks** | Medium | **Rollback** | Revert |
| **Tests** | Clinical | **Difficulty** | Medium |

---

### SP-C-06 — AuditActionType registry test ⚡

| Field | Value |
|-------|-------|
| **Goal** | All `logAudit` call sites use union members |
| **Scope** | `tests/architecture/audit-action-types.test.ts` (grep vs union) |
| **Files** | `server/lib/audit.ts`, `server/**` |
| **Non-goals** | New audit kinds |
| **Depends on** | — |
| **Acceptance** | CI fails on string literal not in union |
| **Risks** | False positives on dynamic strings | **Rollback** | report-only |
| **Tests** | Architecture | **Difficulty** | Medium |

---

### SP-C-07 — Authority: require DB role integration test expansion

| Field | Value |
|-------|-------|
| **Goal** | JWT cannot elevate role; `vt_users.role` wins |
| **Scope** | Extend `tests/users-me-authority.test.ts`, dev headers only in dev-bypass |
| **Files** | `server/middleware/auth.ts`, tests |
| **Non-goals** | Clerk changes |
| **Depends on** | — |
| **Acceptance** | Production path test documents JWT ignored for authz |
| **Risks** | Low | **Rollback** | Revert |
| **Tests** | Authority tests | **Difficulty** | Medium |

---

### SP-C-08 — Clinical-invariant shadow metrics 👻📦

| Field | Value |
|-------|-------|
| **Goal** | Dashboard/query for `clinical_invariant_shadow_would_have_blocked` rate per clinic |
| **Scope** | Admin read API or extend stability dashboard |
| **Files** | `server/routes/admin*.ts`, `server/lib/metrics.ts` |
| **Non-goals** | Turning on enforce |
| **Depends on** | SP-C-04 |
| **Acceptance** | Ops can see shadow blocks before enforce |
| **Risks** | Low | **Rollback** | Hide route |
| **Tests** | Metrics cardinality test | **Difficulty** | Medium |

---

### SP-C-09 — Per-clinic enforce promotion runbook + script 🚩📦

| Field | Value |
|-------|-------|
| **Goal** | Documented steps: shadow metrics OK → enforce for clinic X |
| **Scope** | `scripts/clinical/promote-evaluator-enforce.ts`, `docs/runbooks/evaluator-enforce.md` |
| **Files** | `scripts/clinical/*`, `server/lib/authority/enforcement/*` |
| **Non-goals** | Global enforce |
| **Depends on** | SP-C-08 |
| **Acceptance** | Dry-run mode; audit log of promotion |
| **Risks** | 🔴 Wrong clinic enforced | **Rollback** | Revert clinic to shadow |
| **Tests** | Script dry-run test | **Difficulty** | Medium |

---

### SP-C-10 — Frozen surface change gate ❄️

| Field | Value |
|-------|-------|
| **Goal** | PR template + CI label `frozen-surface` requires checklist |
| **Scope** | `.github/*`, `docs/runbooks/frozen-surface-review.md` |
| **Files** | `.github/*`, `docs/runbooks/*` |
| **Non-goals** | Code changes to realtime |
| **Depends on** | SP-A-02 |
| **Acceptance** | Checklist cites Phase 9 drills |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | `tests/phase-9-deterministic-drills.test.ts` mandatory in template | **Difficulty** | Small |

---

**Wave C multi-release:** SP-C-08 → SP-C-09 per clinic over **weeks/months**.

---

# Wave D — Offline reliability

**Why now:** Registry tests exist; harden **coordination** with Track OFFLINE — do not duplicate OFFLINE phases.  
**Why not earlier:** OFFLINE Phases 1–2 must land first; SCALE Wave D **extends** with docs/tests/ops, not competing sync semantics.  
**Production risk removed:** Silent queue drops, duplicate pending sync, conflict UX gaps.

**Track rule:** If OFFLINE team owns a phase item below, **close or defer** the matching SCALE PR and add a link in PR description.

| SCALE PR | Defer until OFFLINE phase |
|----------|---------------------------|
| SP-D-02 | Phase 2 (hard-fail semantics) |
| SP-D-03 | Phase 4 (replay idempotency) |
| SP-D-04 | Phase 6 (operator UX/i18n) |
| SP-D-05 | Phase 9 (reconciliation) |
| SP-D-07 | Phase 7 (emergency CI gate) — **merge efforts** |
| SP-D-08 | Phase 3 (Dexie schema) |

---

### SP-D-01 — Offline registry changelog + PR template hook ⚡

| Field | Value |
|-------|-------|
| **Goal** | Any PR touching `api.ts` enqueue must update `docs/seams/offline-registry-changelog.md` |
| **Scope** | Template + `tests/offline-mutation-registry.test.ts` (already discovers producers) |
| **Files** | `docs/seams/offline-registry-changelog.md`, `.github/pull_request_template.md` |
| **Non-goals** | New sync types |
| **Depends on** | SP-A-02 |
| **Acceptance** | Changelog has dated entries |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | Existing offline registry tests | **Difficulty** | Small |

---

### SP-D-02 — Sync engine state machine contract tests

| Field | Value |
|-------|-------|
| **Goal** | Document retries, circuit breaker, burst in tests |
| **Scope** | `tests/offline/sync-engine-semantics.test.ts` (MAX_RETRIES, CIRCUIT_*) |
| **Files** | `src/lib/sync-engine.ts` |
| **Non-goals** | Behavior change |
| **Depends on** | — |
| **Acceptance** | Tests match constants in file |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | New | **Difficulty** | Medium |

---

### SP-D-03 — Pending sync idempotency key audit

| Field | Value |
|-------|-------|
| **Goal** | Each `PendingSyncType` maps to server idempotency strategy |
| **Scope** | `docs/seams/offline-idempotency.md`, tests for equipment version-check |
| **Files** | `src/lib/offline-db.ts`, `src/lib/api.ts`, server equipment routes |
| **Non-goals** | New keys in DB |
| **Depends on** | SP-C-03 pattern |
| **Acceptance** | Table complete for all PRODUCTION_ENQUEUE_PRODUCER_TYPES |
| **Risks** | 🔴 Duplicate equipment rows | **Rollback** | Doc only |
| **Tests** | Extend offline tests | **Difficulty** | Medium |

---

### SP-D-04 — Conflict resolution playbook + i18n

| Field | Value |
|-------|-------|
| **Goal** | User-facing copy for each conflict strategy |
| **Scope** | `locales/en.json`, `locales/he.json`, `sync-queue-sheet.tsx` |
| **Files** | `locales/*`, `src/components/sync-queue-sheet.tsx` |
| **Non-goals** | New conflict engine |
| **Depends on** | SP-D-01 |
| **Acceptance** | i18n parity check passes |
| **Risks** | Low | **Rollback** | Revert |
| **Tests** | `tests/i18n-parity.test.ts` | **Difficulty** | Medium |

---

### SP-D-05 — Reconciliation layers doc + wiring test

| Field | Value |
|-------|-------|
| **Goal** | Test that realtime reconciliation hook still wired |
| **Scope** | `docs/seams/reconciliation-layers.md`, extend `tests/reconciliation-single-flight.test.ts` |
| **Files** | `src/hooks/*`, `tests/*` |
| **Non-goals** | ❄️ Realtime transport changes |
| **Depends on** | SP-C-10 |
| **Acceptance** | Doc lists 3 layers; tests green |
| **Risks** | ❄️ if touching SSE hooks | **Rollback** | Revert |
| **Tests** | Reconciliation tests | **Difficulty** | Medium |

---

### SP-D-06 — Admin read-only pending sync diagnostics (per clinic)

| Field | Value |
|-------|-------|
| **Goal** | Support sees queue depth metadata (not PII-heavy) |
| **Scope** | `GET /api/admin/sync-diagnostics` — counts by type, oldest timestamp |
| **Files** | `server/routes/admin*.ts`, `src/lib/api.ts` (admin only) |
| **Non-goals** | Client queue upload |
| **Depends on** | SP-A-02 |
| **Acceptance** | Admin-only; clinic scoped |
| **Risks** | Info disclosure | **Rollback** | Remove route |
| **Tests** | Route auth test | **Difficulty** | Medium |

---

### SP-D-07 — Offline emergency block registry sync test ❄️⚡

| Field | Value |
|-------|-------|
| **Goal** | `classifyEmergencyEndpoint` matches server online-only routes |
| **Scope** | `tests/offline/emergency-endpoint-parity.test.ts` |
| **Files** | `src/lib/offline-emergency-block.ts`, `server/routes/code-blue.ts` |
| **Non-goals** | ❄️ Changing blocklist behavior |
| **Depends on** | — |
| **Acceptance** | Code blue paths blocked offline |
| **Risks** | Low | **Rollback** | Revert |
| **Tests** | `tests/offline-emergency-block.test.ts` extend | **Difficulty** | Small |

---

### SP-D-08 — Dexie schema version bump discipline test

| Field | Value |
|-------|-------|
| **Goal** | Fail if `offline-db.ts` stores change without version increment |
| **Scope** | `tests/offline/offline-db-version.test.ts` |
| **Files** | `src/lib/offline-db.ts` |
| **Non-goals** | Schema migration this PR |
| **Depends on** | — |
| **Acceptance** | Test documents current version 3/4 |
| **Risks** | None | **Rollback** | Revert |
| **Tests** | New | **Difficulty** | Small |

---

# Wave E — Contracts and drift prevention

**Why now:** Splits stabilize APIs; golden fixtures catch drift before multi-hospital.  
**Why not earlier:** Need command boundaries and clinical golden vectors.  
**Production risk removed:** Client/server shape mismatch, outbox payload drift, error code renames.

---

### SP-E-01 — Top-10 mutation golden contracts (equipment scan, complete task)

| Field | Value |
|-------|-------|
| **Goal** | Fixture JSON for request/response shape |
| **Scope** | `docs/contracts/*.json`, `tests/contracts/equipment-scan.test.ts`, medication complete |
| **Files** | `tests/contracts/*`, `docs/contracts/*` |
| **Non-goals** | OpenAPI generator |
| **Depends on** | SP-A-09, SP-B-04, SP-C-01 |
| **Acceptance** | Breaking field rename fails test |
| **Risks** | Fixture staleness | **Rollback** | Revert fixtures |
| **Tests** | Contract tests | **Difficulty** | Large |

---

### SP-E-02 — Stable clinical error reason code registry

| Field | Value |
|-------|-------|
| **Goal** | `shared/clinical-reason-codes.ts` + test parity with `apiError()` |
| **Scope** | Export codes; test all used in server |
| **Files** | `shared/*`, `server/lib/apiError.ts`, tests |
| **Non-goals** | Renaming existing codes |
| **Depends on** | SP-C-05 |
| **Acceptance** | No server-only string codes for clinical denies |
| **Risks** | Medium | **Rollback** | Revert |
| **Tests** | Contract + phase-5 error shape | **Difficulty** | Medium |

---

### SP-E-03 — Outbox event type closed union ❄️

| Field | Value |
|-------|-------|
| **Goal** | `server/lib/realtime-event-types.ts` const union; insertRealtimeDomainEvent typed |
| **Scope** | Register all current types; **no behavior change** |
| **Files** | `server/lib/realtime-outbox.ts`, call sites |
| **Non-goals** | ❄️ Publisher timing, SSE format |
| **Depends on** | SP-C-10 |
| **Acceptance** | `tsc` strict; new type requires union add |
| **Risks** | 🔴 Missed event type blocks deploy | **Rollback** | Revert union |
| **Tests** | `tests/event-reducer-task-events.test.ts`, outbox tests | **Difficulty** | Large |

---

### SP-E-04 — `api.ts` path ↔ route registration consistency

| Field | Value |
|-------|-------|
| **Goal** | Every `api.ts` `/api/` path exists in server routes |
| **Scope** | `tests/contracts/api-path-registry.test.ts` |
| **Files** | `src/lib/api.ts`, `server/routes/*` |
| **Non-goals** | Webhooks/external |
| **Depends on** | SP-A-04 |
| **Acceptance** | CI fails on orphan client path |
| **Risks** | False positives for dynamic segments | **Rollback** | allowlist |
| **Tests** | New | **Difficulty** | Medium |

---

### SP-E-05 — Realtime payload `eventVersion` bump policy test

| Field | Value |
|-------|-------|
| **Goal** | Document when to bump `REALTIME_PAYLOAD_VERSION` |
| **Scope** | `tests/realtime-payload-version.test.ts`, ADR addendum |
| **Files** | `server/lib/realtime-outbox-version.ts`, `shared/realtime-schema-version.ts` |
| **Non-goals** | ❄️ Client reducer logic change |
| **Depends on** | SP-E-03 |
| **Acceptance** | Test encodes version monotonicity |
| **Risks** | ❄️ | **Rollback** | Revert |
| **Tests** | Realtime tests | **Difficulty** | Medium |

---

### SP-E-06 — OpenAPI fragment: medication + appointments (read-only export)

| Field | Value |
|-------|-------|
| **Goal** | Machine-readable contract for partners/internal |
| **Scope** | `docs/contracts/openapi-medication.yaml` hand-authored from golden |
| **Files** | `docs/contracts/*` |
| **Non-goals** | Codegen sweep |
| **Depends on** | SP-E-01 |
| **Acceptance** | Valid OpenAPI 3.1; reviewed by domain owner |
| **Risks** | Doc drift | **Rollback** | Delete fragment |
| **Tests** | Optional spectral lint | **Difficulty** | Medium |

---

### SP-E-07 — Breaking-change CI script (additive-only default)

| Field | Value |
|-------|-------|
| **Goal** | Compare `docs/contracts/*.json` on PR |
| **Scope** | `scripts/contracts/diff-fixtures.ts`, CI step |
| **Files** | `scripts/contracts/*`, `.github/workflows/ci.yml` |
| **Non-goals** | Auto-approve |
| **Depends on** | SP-E-01 |
| **Acceptance** | Removing JSON field fails without `BREAKING_CHANGE_OK` label |
| **Risks** | False positives | **Rollback** | report-only |
| **Tests** | Script unit test | **Difficulty** | Medium |

---

### SP-E-08 — Phase 5/9 error envelope regression bundle in CI ⚡

| Field | Value |
|-------|-------|
| **Goal** | Ensure `phase-5-error-contract`, `phase-9-metrics-cardinality` always run |
| **Scope** | `.github/workflows/ci.yml` explicit project list |
| **Files** | `.github/workflows/ci.yml` |
| **Non-goals** | New tests |
| **Depends on** | — |
| **Acceptance** | CI job lists tests in log |
| **Risks** | None | **Rollback** | Revert workflow |
| **Tests** | CI | **Difficulty** | Small |

---

# Wave F — Scaling and observability

**Why now:** Multi-hospital + more devs need ops signals without PII cardinality violations.  
**Why not earlier:** Need event types (E) and clinical baselines (C).  
**Production risk removed:** Silent outbox backlog, inventory job stalls, undetected SSE storms.

---

### SP-F-01 — Outbox lag metric + admin tile

| Field | Value |
|-------|-------|
| **Goal** | `max(unpublished_at)` per clinic bounded metric |
| **Scope** | `server/lib/metrics.ts`, admin health route |
| **Files** | `server/lib/event-publisher.ts`, `server/routes/admin*.ts` |
| **Non-goals** | ❄️ Publisher interval change |
| **Depends on** | SP-E-03 |
| **Acceptance** | Metric enum closed; no PII |
| **Risks** | Low | **Rollback** | Remove metric |
| **Tests** | `tests/phase-9-metrics-cardinality.test.ts` | **Difficulty** | Medium |

---

### SP-F-02 — Inventory job age + recovery counter

| Field | Value |
|-------|-------|
| **Goal** | Alert on jobs pending > 5 min |
| **Scope** | Extend `inventory-job-recovery` metrics |
| **Files** | `server/lib/inventory-job-recovery.ts`, workers |
| **Non-goals** | Recovery logic change |
| **Depends on** | — |
| **Acceptance** | Metric increments on recovery |
| **Risks** | Low | **Rollback** | Revert |
| **Tests** | `tests/inventory-job-recovery-scheduler.test.ts` | **Difficulty** | Medium |

---

### SP-F-03 — SSE storm hint observability ❄️

| Field | Value |
|-------|-------|
| **Goal** | Log/metric when `stormHint=elevated` |
| **Scope** | `server/routes/realtime.ts` telemetry path (bounded enum only) |
| **Files** | `server/routes/realtime.ts`, `server/lib/metrics.ts` |
| **Non-goals** | ❄️ Threshold change |
| **Depends on** | SP-C-10, SP-E-08 |
| **Acceptance** | Cardinality test passes |
| **Risks** | ❄️ | **Rollback** | Revert |
| **Tests** | Phase 9 metrics | **Difficulty** | Medium |

---

### SP-F-04 — Client sync telemetry (bounded) ⚡

| Field | Value |
|-------|-------|
| **Goal** | `sync_permanent_failure`, `circuit_open` counters to POST telemetry |
| **Scope** | `src/lib/sync-engine.ts`, `server/routes/realtime.ts` enum |
| **Files** | `src/lib/sync-engine.ts`, `server/routes/realtime.ts` |
| **Non-goals** | Raw queue payloads |
| **Depends on** | SP-D-02 |
| **Acceptance** | Enum closed on both sides |
| **Risks** | Cardinality | **Rollback** | Revert client posts |
| **Tests** | Phase 9 metrics | **Difficulty** | Medium |

---

### SP-F-05 — DLQ admin UX improvements

| Field | Value |
|-------|-------|
| **Goal** | Faster ops triage for `vt_event_outbox` DLQ |
| **Scope** | `server/routes/admin-outbox-dlq.ts`, admin UI |
| **Files** | `server/routes/admin-outbox-dlq.ts`, `src/pages/*admin*` |
| **Non-goals** | Publisher rewrite |
| **Depends on** | SP-F-01 |
| **Acceptance** | clinic-scoped; audit actions logged |
| **Risks** | Medium | **Rollback** | Revert UI |
| **Tests** | Route tests | **Difficulty** | Medium |

---

### SP-F-06 — Per-clinic feature config table pattern 🗄️🚩

| Field | Value |
|-------|-------|
| **Goal** | Generalize evaluator mode pattern for ER minutes, integration flags |
| **Scope** | `vt_clinic_feature_config` or JSONB on `vt_clinics` with migration |
| **Files** | `server/db.ts`, `migrations/*`, read helper |
| **Non-goals** | Migrating all flags at once |
| **Depends on** | SP-C-09 |
| **Acceptance** | Migration applied; default preserves current behavior |
| **Risks** | 🗄️ Migration failure | **Rollback** | Migration down |
| **Tests** | Migration test | **Difficulty** | Large |

---

### SP-F-07 — Integration health dashboard (read-only)

| Field | Value |
|-------|-------|
| **Goal** | Per-clinic integration sync lag |
| **Scope** | `server/integrations/*`, admin route |
| **Files** | `server/integrations/*`, routes |
| **Non-goals** | New adapters |
| **Depends on** | SP-F-06 |
| **Acceptance** | Tenancy enforced |
| **Risks** | Low | **Rollback** | Revert route |
| **Tests** | Integration tests | **Difficulty** | Medium |

---

### SP-F-08 — Support read APIs: idempotency key lookup

| Field | Value |
|-------|-------|
| **Goal** | Support traces billing duplicate disputes |
| **Scope** | `GET /api/admin/billing/by-idempotency-key` |
| **Files** | `server/routes/admin*.ts`, billing service |
| **Non-goals** | Mutations |
| **Depends on** | SP-C-03 |
| **Acceptance** | Admin + clinic scoped |
| **Risks** | Info disclosure | **Rollback** | Remove |
| **Tests** | Auth test | **Difficulty** | Medium |

---

# Wave G — Long-term hardening

**Why now:** Core splits done; polish for multi-team velocity.  
**Why not earlier:** Would fight god-file extraction.  
**Production risk removed:** Long-term entropy, load failures, integration bleed.

---

### SP-G-01 — Delete `appointments.service.ts` legacy monolith file 📦

| Field | Value |
|-------|-------|
| **Goal** | Single import path only |
| **Scope** | Remove shim; fix all imports |
| **Files** | `server/services/appointments.service.ts` DELETE |
| **Non-goals** | Behavior change |
| **Depends on** | SP-B-10, all appointment tests green |
| **Acceptance** | knip clean for file; tsc clean |
| **Risks** | 🔴 Hidden imports | **Rollback** | Restore file |
| **Tests** | Full appointment suite | **Difficulty** | Large |

---

### SP-G-02 — Equipment routes 3/N: finish extraction

| Field | Value |
|-------|-------|
| **Goal** | `equipment.ts` < 500 LOC router wiring only |
| **Scope** | Remaining handlers |
| **Files** | `server/routes/equipment/*` |
| **Non-goals** | Business rule changes |
| **Depends on** | SP-B-08 |
| **Acceptance** | Offline registry green |
| **Risks** | 🔴 | **Rollback** | Revert |
| **Tests** | Offline + equipment | **Difficulty** | Very Large |

---

### SP-G-03 — Integration adapter ports

| Field | Value |
|-------|-------|
| **Goal** | `server/integrations/ports/*`; clinical services cannot import vendor SDKs |
| **Scope** | Move IDEXX/Covetrus behind interfaces |
| **Files** | `server/integrations/*` |
| **Non-goals** | New vendors |
| **Depends on** | SP-B-05 |
| **Acceptance** | Architecture import test |
| **Risks** | Medium | **Rollback** | Revert |
| **Tests** | `tests/integration-adapter-template.test.ts` | **Difficulty** | Large |

---

### SP-G-04 — ~~SSE load harness~~ **CANCELLED — use AUDIT PR-26**

**Parallelization:** N/A — duplicate of `IMPLEMENTATION_PLAN.md` PR-26. SCALE track links runbook from AUDIT PR instead of reimplementing.

---

### SP-G-05 — Module READMEs at seams (batch)

| Field | Value |
|-------|-------|
| **Goal** | README per `appointments/`, `medication-tasks/`, `er/`, sync, outbox |
| **Scope** | Entry points, events, offline keys |
| **Files** | `server/services/*/README.md`, `src/lib/README-sync.md` |
| **Non-goals** | Narrative docs duplicating CONTEXT |
| **Depends on** | SP-G-01 |
| **Acceptance** | Reviewed by owners |
| **Risks** | Stale docs | **Rollback** | Delete |
| **Tests** | None | **Difficulty** | Small |

---

### SP-G-06 — Tenancy integration test expansion (cross-clinic negative)

| Field | Value |
|-------|-------|
| **Goal** | Prove clinic A cannot read clinic B for top 5 resources |
| **Scope** | `tests/tenancy/isolation.test.ts` |
| **Files** | `tests/tenancy/*`, test helpers |
| **Non-goals** | RLS in Postgres |
| **Depends on** | SP-A-10 |
| **Acceptance** | 5 domains covered |
| **Risks** | Flaky if data setup wrong | **Rollback** | Revert |
| **Tests** | DB integration | **Difficulty** | Large |

---

### SP-G-07 — Scheduled knip debt burn-down (quarterly program)

| Field | Value |
|-------|-------|
| **Goal** | Reduce knip baseline 10% per quarter |
| **Scope** | Follow removal protocol |
| **Files** | repo-wide |
| **Non-goals** | Big bang delete |
| **Depends on** | SP-A-05 |
| **Acceptance** | Baseline number decreases |
| **Risks** | Accidental feature removal | **Rollback** | Revert commits |
| **Tests** | knip + tsc | **Difficulty** | Medium (ongoing) |

---

### SP-G-08 — `shared/` INTERNAL file relocation 📦

| Field | Value |
|-------|-------|
| **Goal** | Move non-contract shared code to `server/shared/` or `src/shared/` |
| **Scope** | Per SP-B-06 audit |
| **Files** | `shared/*` |
| **Non-goals** | Breaking client imports |
| **Depends on** | SP-B-06, SP-E-02 |
| **Acceptance** | Contract test passes; re-exports during transition |
| **Risks** | 🔴 Bundle break | **Rollback** | Re-export shim |
| **Tests** | shared-contract test | **Difficulty** | Large |

---

# Cross-wave: Hidden problems checklist

| Problem | Detection PR | Mitigation PR |
|---------|----------------|---------------|
| God services | SP-A-01 map | SP-B-01–04, SP-G-01 |
| Circular deps | SP-B-05 | import-layer test |
| Duplicate business rules | SP-C-01, SP-C-05 | ports, characterization |
| Contract drift | SP-E-01, SP-E-04, SP-E-07 | golden fixtures |
| Missing ownership | SP-A-02 | CODEOWNERS |
| Offline queue inconsistency | SP-D-01, SP-D-03, registry tests | SP-B-08 |
| Cross-clinic bugs | SP-A-10, SP-G-06 | tenancy tests |
| Realtime ordering | SP-E-03, SP-E-05 | ❄️ frozen + drills |
| Idempotency gaps | SP-C-03, SP-D-03, SP-F-08 | billing audit |
| Worker not registered | SP-A-04 | architecture test |
| Evaluator enforce too early | SP-C-08, SP-C-09 | 👻 shadow first |

---

# PR index (quick reference)

| PR | Wave | Difficulty | Tags |
|----|------|------------|------|
| SP-A-01 | A | S | ⚡ |
| SP-A-02 | A | S | ⚡ |
| SP-A-03 | A | S | ⚡ |
| SP-A-04 | A | S | ⚡ |
| SP-A-05a | A | S | ⚡ partial |
| SP-A-05b | A | M | seq |
| SP-A-06 | A | M | |
| SP-A-07 | A | S | |
| SP-A-08 | A | S | |
| SP-A-09 | A | S | ⚡ |
| SP-A-10 | A | M | 🔴 |
| SP-B-01 | B | M | 🔴 |
| SP-B-02 | B | L | |
| SP-B-03a | B | L | 🔴 seq PR-17 |
| SP-B-03b | B | L | 🔴 seq PR-22 |
| SP-B-04 | B | VL | 🔴 seq |
| SP-B-05 | B | L | |
| SP-B-06 | B | M | ⚡ |
| SP-B-07 | B | L | |
| SP-B-08 | B | VL | 🔴 |
| SP-B-09 | B | L | |
| SP-B-10 | B | M | |
| SP-C-01 | C | M | ⚡👻 |
| SP-C-02 | C | L | 🔴 |
| SP-C-03 | C | M | 🔴 |
| SP-C-04 | C | M | 👻🚩 |
| SP-C-05 | C | M | |
| SP-C-06 | C | M | ⚡ |
| SP-C-07 | C | M | |
| SP-C-08 | C | M | 👻📦 |
| SP-C-09 | C | M | 🚩📦 🔴 |
| SP-C-10 | C | S | ❄️ |
| SP-D-01 | D | S | ⚡ |
| SP-D-02 | D | M | |
| SP-D-03 | D | M | 🔴 |
| SP-D-04 | D | M | |
| SP-D-05 | D | M | ❄️ |
| SP-D-06 | D | M | |
| SP-D-07 | D | S | ❄️⚡ |
| SP-D-08 | D | S | |
| SP-E-01 | E | L | |
| SP-E-02 | E | M | |
| SP-E-03 | E | L | ❄️🔴 |
| SP-E-04 | E | M | |
| SP-E-05 | E | M | ❄️ |
| SP-E-06 | E | M | |
| SP-E-07 | E | M | |
| SP-E-08 | E | S | ⚡ |
| SP-F-01 | F | M | |
| SP-F-02 | F | M | |
| SP-F-03 | F | M | ❄️ |
| SP-F-04 | F | M | |
| SP-F-05 | F | M | |
| SP-F-06 | F | L | 🗄️🚩 |
| SP-F-07 | F | M | |
| SP-F-08 | F | M | |
| SP-G-01 | G | L | 🔴📦 |
| SP-G-02 | G | VL | 🔴 |
| SP-G-03 | G | L | |
| SP-G-04 | G | — | **Use AUDIT PR-26** |
| SP-G-05 | G | S | |
| SP-G-06 | G | L | 🔴 |
| SP-G-07 | G | M | ongoing |
| SP-G-08 | G | L | 📦🔴 |

**Total: 59 active SCALE PRs** (SP-G-04 cancelled → AUDIT PR-26; SP-A-05 → 05a/b; SP-B-03 → 03a/b).

---

# Coordination costs (explicit)

- **Weekly tri-track sync (30 min):** AUDIT + OFFLINE + SCALE leads — open PRs on hotspots, who merges first.
- **Merge queue:** One PR per hotspot file; no “rebase and pray” on `equipment.ts` / `sync-engine.ts`.
- **Monthly clinical safety:** shadow metrics (SP-C-08/09); never same week as OFFLINE Phase 2 hard-fail prod enable.
- **Feature lane rule:** product PRs must not expand god files; new logic → new command file (SP-B-10).
- **Ugly middle:** 2-import-path + OFFLINE Phase 3 Dexie fields + AUDIT PR-18 version in flight = **normal** for one quarter.

---

# Things that get worse before better

1. **Rebase churn** — three programs + features touch `api.ts` weekly.
2. **CI time** — AUDIT sharding + SCALE contract tests + OFFLINE drills.
3. **Duplicated specs** — OFFLINE Phase 4 vs SP-D-03 until coordinated.
4. **Slower Wave B** — AUDIT PR-18/22 gate god-file splits for months.
5. **PR-28…36 smokes ≠ flows** — SCALE E2E fixtures must not assume full flows exist (see `IMPLEMENTATION_PLAN.md` Phase 10 correction).

---

# Start this week (critical path under 10–20% SCALE capacity)

**If AUDIT + OFFLINE already in flight:**

1. SP-A-01 (v2 doc) + SP-A-02 + SP-A-04 + SP-A-09 — **safe parallel** with OFFLINE Phase 1
2. SP-C-01 — **safe parallel** (tests only) if no open medication refactor
3. **Do not start** SP-B-07/08, SP-D-02, SP-F-04 until conflict matrix gates clear
4. SP-D-01 changelog — **partial parallel** with OFFLINE Phase 1 (coordinate owner)

**Do not start:** SP-B-03a/b, SP-E-03 while AUDIT PR-17/18 open (SP-G-04 cancelled — use PR-26).

---

# Appendix A — Parallelization status (all SCALE PRs)

| PR | Status | Why |
|----|--------|-----|
| SP-A-01 | Safe parallel | Docs |
| SP-A-02 | Safe parallel | CODEOWNERS |
| SP-A-03 | Safe parallel | ADRs |
| SP-A-04 | Safe parallel | Architecture tests |
| SP-A-05a | Partial parallel | CI file — yield to AUDIT PR-02–05 |
| SP-A-05b | Sequential only | After 05a + AUDIT CI stable |
| SP-A-06 | Partial parallel | Update when AUDIT PR-15 lands |
| SP-A-07 | Safe parallel | Team doc |
| SP-A-08 | Safe parallel | PR template |
| SP-A-09 | Safe parallel | Contract harness |
| SP-A-10 | Partial parallel | Report-only until AUDIT PR-15 done |
| SP-B-01 | Partial parallel | Blocked if AUDIT PR-22 open |
| SP-B-02 | Partial parallel | After B-01; avoid PR-22 conflicts |
| SP-B-03a | Sequential only | After AUDIT PR-17 |
| SP-B-03b | Sequential only | After AUDIT PR-22 + B-03a |
| SP-B-04 | Sequential only | After B-03a; not during AUDIT PR-15/30 |
| SP-B-05 | Sequential only | After B-04 |
| SP-B-06 | Safe parallel | shared/ audit |
| SP-B-07 | Sequential only | After AUDIT PR-18 |
| SP-B-08 | Sequential only | After PR-18 + OFFLINE Phase 2 |
| SP-B-09 | Partial parallel | ER folder; avoid ER feature PRs |
| SP-B-10 | Sequential only | After B-03a minimum |
| SP-C-01 | Safe parallel | Golden vectors; no behavior change |
| SP-C-02 | Sequential only | After AUDIT PR-15; not with PR-20 |
| SP-C-03 | Partial parallel | Audit doc; coordinate AUDIT billing |
| SP-C-04 | Safe parallel | Template evaluator |
| SP-C-05 | Partial parallel | After dispense AUDIT PR-31 |
| SP-C-06 | Partial parallel | Report-only audit grep first |
| SP-C-07 | Safe parallel | Auth tests |
| SP-C-08 | Partial parallel | Metrics; avoid realtime PR-32 week |
| SP-C-09 | Sequential only | Per-clinic; monthly guild |
| SP-C-10 | Safe parallel | Process doc ❄️ |
| SP-D-01 | Partial parallel | Changelog only; OFFLINE owns registry |
| SP-D-02 | Sequential only | After OFFLINE Phase 2 + AUDIT PR-24 |
| SP-D-03 | Sequential only | After OFFLINE Phase 4 |
| SP-D-04 | Sequential only | After OFFLINE Phase 6 |
| SP-D-05 | Partial parallel | Doc early; tests after OFFLINE Phase 9 |
| SP-D-06 | Safe parallel | New admin route if no collision |
| SP-D-07 | Partial parallel | Merge with OFFLINE Phase 7 gate |
| SP-D-08 | Sequential only | After OFFLINE Phase 3 |
| SP-E-01 | Partial parallel | After AUDIT PR-17/18 for fixtures |
| SP-E-02 | Partial parallel | Align AUDIT phase-5 error tests |
| SP-E-03 | Partial parallel | ❄️ outbox types; small call-site diff |
| SP-E-04 | Safe parallel | api path test |
| SP-E-05 | Partial parallel | ❄️ version policy |
| SP-E-06 | Safe parallel | OpenAPI doc |
| SP-E-07 | Partial parallel | After E-01 fixtures |
| SP-E-08 | Sequential only | After AUDIT PR-05 CI |
| SP-F-01 | Partial parallel | After E-03 |
| SP-F-02 | Safe parallel | Inventory metrics |
| SP-F-03 | Partial parallel | ❄️; not during AUDIT PR-32 |
| SP-F-04 | Sequential only | After AUDIT PR-24 + OFFLINE Phase 8 |
| SP-F-05 | Partial parallel | Admin UI |
| SP-F-06 | Sequential only | After AUDIT PR-22 migration window |
| SP-F-07 | Safe parallel | Integrations read |
| SP-F-08 | Partial parallel | After C-03 |
| SP-G-01 | Sequential only | After B-10 + all appointment tests green |
| SP-G-02 | Sequential only | After B-08 |
| SP-G-03 | Partial parallel | Integrations |
| SP-G-04 | **Cancelled → use AUDIT PR-26** | Duplicate SSE harness |
| SP-G-05 | Safe parallel | READMEs |
| SP-G-06 | Sequential only | Serialize with AUDIT PR-20 DB tests |
| SP-G-07 | Safe parallel | Ongoing quarterly |
| SP-G-08 | Sequential only | After E-02 + B-06 |

---

*Document version: 2.0 — tri-track coordination. Branch: `cursor/scaling-program-v2-b503` for SP-A-01 update PR.*

