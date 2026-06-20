# PLAN.md

> The single source of truth for what is being built right now.
> Agents read this before writing any code.
> Update when the plan changes. Do not let it drift from reality.
> Archive completed plans to `docs/plans/YYYY-MM-DD-[feature].md`

---

## Metadata

| | |
|-|-|
| **Feature / Sprint** | Maintenance & Operational Hardening |
| **Author** | VetTrack Team |
| **Created** | 2026-06-20 |
| **Last updated** | 2026-06-20 |
| **Status** | `in-progress` |
| **Branch** | `main` / feature branches |
| **Tasks** | See TASKS.md |

---

## Problem

VetTrack has completed Phases 1–9 (equipment tracking, medication workflows, inventory, scheduling, billing, realtime SSE, Code Blue, PWA/offline-first, and multi-tenant auth). The platform is now in **maintenance mode** — the architecture is stable and frozen in key areas. Work focuses on reliability, bug fixes, performance improvements, and incremental feature additions within the defined scope.

Scope change (June 2026): ER/patient/hospitalization tables, medication tasks, drug formulary, and pharmacy forecast were removed (migrations 142–143). See `docs/scope-change-2026.md`.

---

## Goal

Maintain and improve VetTrack's operational stability, ensuring the platform continues to serve multi-clinic veterinary operations reliably while incrementally adding value within the established architectural boundaries.

---

## Out of Scope

- ER/patient/hospitalization workflows (removed June 2026)
- Medication task management and drug formulary (removed June 2026)
- Pharmacy forecast engine (removed June 2026)
- WebSockets or polling as a realtime transport (SSE is frozen)
- Offline queueing of Code Blue / emergency mutations
- Appointment → task renames of internal surfaces (only copy changed)
- Any work in the Expo/RN mobile repo (`exposwifty31/literate-dollop`) — separate repo

---

## Constraints

- Every DB table must filter by `clinicId` — multi-tenancy is non-negotiable
- Realtime transport is frozen: SSE via `/api/realtime/stream`, not WebSockets
- BroadcastChannel envelope shape (`cursor`, `buildTag`, `ts`, `senderNonce`, `kind`) is frozen
- `__VT_BUILD_TAG__` is the single source of truth for SW cache naming
- Emergency endpoints must never be cached (bypass is unconditional)
- Authority evaluators keep their `off | shadow | enforce` envelope
- Strategy A safety net stays byte-for-byte identical
- `AuditActionType` union is closed — new kinds added to the union explicitly
- Telemetry surfaces are bounded enums — no PII, no free-form labels
- `appointmentsPage.*` i18n namespace, `vt_appointments` table, `/api/appointments` route are not renamed

---

## Active Work Areas

### Area 1: Bug Fixes and Reliability
Address issues in BUG_REGISTER.md. Each fix gets its own task.

**Files commonly in scope:**
- `server/routes/` — route-level bug fixes
- `server/services/` — domain service logic
- `src/pages/` — frontend page fixes
- `server/lib/` — shared business logic

**Exit criteria per fix:**
- [ ] Regression test added
- [ ] Full test suite passes
- [ ] `BUG_REGISTER.md` updated

**Status:** `in-progress`

---

### Area 2: Performance and N+1 Query Elimination
Per `docs/PF-02-hot-route-n1-investigation.md`, eliminate identified N+1 query patterns.

**Files in scope:**
- `server/services/` — service layer queries
- `server/routes/` — route handlers that bypass services

**Exit criteria:**
- [ ] Identified N+1 queries replaced with joins or batched fetches
- [ ] Response time benchmarks improve

**Status:** `not started`

---

### Area 3: Test Coverage Gaps
Fill test coverage for untested or under-tested server routes and services.

**Files in scope:**
- `tests/` — new test files
- Any route or service file lacking coverage

**Exit criteria:**
- [ ] New test file created for target module
- [ ] Tests cover success and at least one failure path

**Status:** `in-progress`

---

## Testing Plan

- `pnpm test` — full Vitest suite (excludes DB/live-server tests)
- `npx tsc --noEmit` — TypeScript type check (must pass zero errors)
- `pnpm build` — production build verification
- Playwright E2E: `pnpm test:signup` for signup flow; Phase 9 drills via `playwright.ui.config.ts`

---

## Rollback Plan

All changes land on feature branches merged via PR. Rollback = revert the merge commit on `main`. Database migrations include down migrations. No data-destructive operations without explicit sign-off.

---

## Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| Which N+1 queries in PF-02 are highest priority? | Team | `open` |

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Maintenance mode adopted June 2026 | Core feature set complete; focus shifts to reliability |
| ER/medication scope removed | Product decision — out of core veterinary operations platform scope |
