# DEFINITION_OF_DONE.md

> A task is not done until every applicable item is checked.
> "Done" does not mean "the code works on my machine."
> Agents must not mark a task complete in TASKS.md until this checklist passes.

---

## Code Quality

- [ ] `npx tsc --noEmit` passes with zero new errors or suppressions
- [ ] No new lint errors or warnings
- [ ] No `TODO`, `FIXME`, `HACK`, or `XXX` comments in delivered code
- [ ] No commented-out code blocks
- [ ] No debug logging left in (`console.log`, `debugger`)
- [ ] No hardcoded secrets, credentials, or environment-specific values
- [ ] No new npm packages added without noting them in the task response

## Correctness

- [ ] Implementation matches the acceptance criteria in `TASKS.md`
- [ ] Implementation follows the approach in `PLAN.md` — or `PLAN.md` updated to reflect deviation
- [ ] All code paths handle errors — nothing silently swallowed
- [ ] Edge cases identified in the task are handled
- [ ] No unintended side effects on code outside the task scope

## VetTrack Invariants

- [ ] Every new DB query filters by `clinicId` (multi-tenancy invariant — no exceptions)
- [ ] No emergency endpoint added to any SW cache path (`/api/code-blue/*`, `/api/display/snapshot`, `/api/realtime/*`)
- [ ] No changes to SSE realtime transport, BroadcastChannel envelope shape, or `__VT_BUILD_TAG__` semantics
- [ ] No appointment → task renames of internal surfaces (`vt_appointments`, `/api/appointments`, `appointmentsPage.*` keys)
- [ ] New audit kinds added to `AuditActionType` union in `server/lib/audit.ts` (not logged as raw strings)
- [ ] New realtime telemetry surfaces added as bounded enums on both client and `server/routes/realtime.ts`
- [ ] Auth / security changes have a hard stop and human review (no agent-only merge)

## Tests

- [ ] `pnpm test` passes (full Vitest suite)
- [ ] New behaviour has tests
- [ ] New tests cover at least one failure path, not only the happy path
- [ ] Test names describe expected behaviour, not implementation details
- [ ] No test infrastructure left in production code paths

## i18n

- [ ] New user-facing copy added to both `locales/he.json` and `locales/en.json`
- [ ] No Hebrew strings hardcoded in `.ts`/`.tsx` source files
- [ ] `pnpm test -- tests/i18n-parity.test.ts` passes

## Documentation

- [ ] `TASKS.md` updated — task marked complete with notes
- [ ] `PLAN.md` updated if the approach deviated
- [ ] `docs/decisions/` updated if a non-obvious architectural decision was made
- [ ] `BUG_REGISTER.md` updated if fixing a registered bug

## Schema Changes (when applicable)

- [ ] `npx drizzle-kit generate` run after schema edits → SQL file committed
- [ ] Migration tested via `pnpm db:migrate`
- [ ] Migration is backward-compatible, or a deployment plan exists
- [ ] New table has a `clinicId` column

## API Changes (when applicable)

- [ ] Backward-compatible, or existing callers updated
- [ ] Error responses follow the established format (`apiError()` from `server/lib/apiError.ts`)
- [ ] New endpoints authenticated if they access non-public data
- [ ] Input validation present on all new endpoints
- [ ] New API function exported from `src/lib/api.ts` with a typed response in `src/types/`

## Build Verification

- [ ] `pnpm build` produces a clean production build

---

## What "Done" Is Not

- "It works in dev" — the test suite must pass
- "I tested it manually" — manual testing supplements automated tests; it does not replace them
- "TypeScript is happy" — types passing does not verify runtime behaviour
- "I'll clean it up later" — code that ships is code that stays
- "The realtime/PWA change is low-risk" — touching Phase 9 surfaces requires browser verification via Playwright drills (`tests/phase-9-drills.spec.ts`)
