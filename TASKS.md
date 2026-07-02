# TASKS.md

> Agents: read this to find your task. Update status when you finish.
> Humans: add tasks here before starting an agent session.
>
> One task = one logical change. If a task takes more than one session, split it.
>
> See PLAN.md for the active sprint scope. See BUG_REGISTER.md for known defects.

---

## In Progress

_No tasks currently in progress. Pick one from "Ready to Start" below._

---

## Ready to Start

### TASK-001: Eliminate N+1 queries on equipment list endpoint
**Priority:** `high`
**Linked plan step:** Area 2 — Performance

**What to do:**
The `/api/equipment` list route makes per-row queries for room and dock associations.
Replace with a single JOIN query using Drizzle ORM. Target file is `server/routes/equipment.ts`
and the underlying service in `server/services/equipment.ts`. Do not touch unrelated routes.

**Acceptance criteria:**
- [ ] Equipment list endpoint uses a single query with JOINs instead of N+1 selects
- [ ] Unit tests added for the updated service function
- [ ] `pnpm test` passes
- [ ] `npx tsc --noEmit` passes with zero new errors
- [ ] No TODO comments in delivered code

**Files in scope:**
- `server/routes/equipment.ts`
- `server/services/equipment.ts`
- `tests/` — new test file for the updated query

**Files NOT in scope:**
- Any other route files
- Frontend code

**Notes:**
Every query must filter by `clinicId` — this is a multi-tenancy invariant. Do not remove or bypass it.

---

### TASK-002: Add missing test coverage for restock service
**Priority:** `medium`
**Linked plan step:** Area 3 — Test Coverage

**What to do:**
`server/services/restock.ts` has insufficient test coverage. Add unit tests for the
core restock creation and completion flows, including validation errors.
The DB integration test file `tests/restock.service.test.ts` is excluded from the
default test suite — add a unit test file instead that mocks the DB layer.

**Acceptance criteria:**
- [ ] New unit test file created at `tests/restock.service.unit.test.ts`
- [ ] Happy path (create restock, complete restock) covered
- [ ] At least two failure paths covered (validation error, not-found)
- [ ] `pnpm test` passes
- [ ] `npx tsc --noEmit` passes

**Files in scope:**
- `tests/restock.service.unit.test.ts` (new)
- `server/services/restock.ts` (read-only — do not modify)

**Files NOT in scope:**
- `tests/restock.service.test.ts` (DB integration test — leave unchanged)

---

### TASK-003: Add Hebrew translations for any missing keys
**Priority:** `low`
**Linked plan step:** Maintenance

**What to do:**
Run `pnpm test -- tests/i18n-parity.test.ts` to identify any missing translation keys
between `locales/en.json` and `locales/he.json`. Add any missing Hebrew translations.
Do not add hardcoded Hebrew strings to `.ts`/`.tsx` source files — Hebrew belongs
only in `locales/*.json`.

**Acceptance criteria:**
- [ ] `pnpm test -- tests/i18n-parity.test.ts` passes
- [ ] `pnpm test -- tests/i18n-no-hebrew-in-source.test.ts` passes
- [ ] All keys present in both locale files

**Files in scope:**
- `locales/he.json`
- `locales/en.json`

**Files NOT in scope:**
- Any `.ts` / `.tsx` source files

---

## Blocked

_None currently blocked._

---

## Completed

_Archive completed tasks here with date and notes._

---

## Backlog

_Agents: add out-of-scope items here rather than acting on them._

- TASK: Investigate stale check-in sweep worker — confirm TTL sweep is running in production
- TASK: Audit `vt_event_outbox` retention — verify janitor is not letting the table grow unbounded
- TASK: Review Playwright Phase 9 drills — confirm all 8 drills pass against local dev server
- TASK: Add `.cursor/rules/` vettrack-specific overrides for i18n and multi-tenancy invariants
- TASK: Codebase relevance cleanup — delete root artifacts (`Archive.zip`, `Archive 2.zip`, `all-files.md`, `screenshot.png`, `app-tour.js`) after human approval
- TASK: Remove dead `src/features/today/*` module (6 files; `/app-tour` redirects to `/home`; knip unused)
- TASK: Audit `docs/design-handoff/` (240 tracked files, ~15MB) — archive externally or trim to active design refs
- TASK: Deduplicate untracked `.agents/skills/ecc/` mirror of `.claude/skills/ecc/` (~1.7MB each); pick one canonical agent-skills path
- TASK: Remove or wire `shared/permissions.ts` (knip unused; server uses `er-mode-permissions.ts` instead)
- TASK: Remove or wire `server/integrations/rollout/*` + `conflicts/*` (knip unused; `vendor-x-rollout.ts` is the active path)
- TASK: Remove stub `inventory-deduction` worker/queue chain per Removal Protocol (`docs/governance/PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md`)

---

## Task Template

```markdown
### TASK-NNN: [Title]
**Priority:** `high` / `medium` / `low`
**Linked plan step:** [PLAN.md Area or standalone]

**What to do:**
[2–4 sentences. Specific enough that an agent can start without asking obvious questions.]

**Acceptance criteria:**
- [ ] [Specific, testable outcome]
- [ ] `pnpm test` passes
- [ ] `npx tsc --noEmit` passes with zero new errors
- [ ] No TODO comments in delivered code

**Files in scope:**
- `path/to/file`

**Files NOT in scope:**
- `path/to/other-file` — [reason]

**Notes:**
[Gotchas, prior attempts, constraints, relevant context]
```
