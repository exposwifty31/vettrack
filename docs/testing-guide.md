# VetTrack Testing Guide

## Overview

VetTrack uses **Vitest** for all automated tests. Tests are static-analysis style — they read source files and assert structural properties — which means they run without a live database, Redis, or Clerk connection.

**All tests must pass before merging to `main`.**

---

## Running Tests

```bash
pnpm test              # run all tests once
pnpm test --watch      # watch mode (re-runs on file changes)
pnpm test <file>       # run a specific test file
```

Current status: run `pnpm test` locally for the live count (static + unit suite; typically ~290+ files, ~50s).

---

## Test File Inventory

Tests live in `tests/` and are organized by phase/feature:

| File | What it covers |
|------|----------------|
| `multi-tenancy-hardening.test.js` | Every route file uses `req.clinicId`; no cross-tenant leakage |
| `phase-9-metrics-cardinality.test.ts` | Phase 9 counters are bounded enums (no PII / free-form labels) |
| `offline-phase-7-emergency-surface-parity.test.ts` | Emergency endpoints match offline block + SW denylist manifest |
| `program-v2-hardening-ci-governance.test.ts` | Asserts the three gates above are not vitest-excluded (CD-05) |
| `phase-5-error-shape-guard.test.js` | Error responses use `{ code, error, reason, message }` shape (siblings: `phase-5-error-contract.test.js`, `phase-5-route-error-contract.test.js`, `phase-5-pr-5-6-error-shape.test.ts`) |
| `phase-3-4-automation.test.js` | Automation engine feature flag wiring |
| `phase-8-mobile-pwa.test.js` | PWA manifest, `dvh` viewport units, `inputMode` attributes |
| `user-auth-lifecycle.test.js` | User delete/restore, Clerk webhook, purge endpoints |
| `integration-adapter.test.js` | Integration layer types, adapter interface, DB schema, routes |
| (+ 61 more) | Coverage of billing, inventory, appointments, security, etc. |

---

## Test Philosophy

**Static analysis over integration tests.** Rather than spinning up a test DB, tests read source files and assert:

- Correct imports are present
- Auth middleware (`requireAdmin`, `requireAuth`) is applied to the right routes
- Audit log calls exist after sensitive mutations
- Error response shapes are consistent
- DB schema matches migration expectations

This makes tests fast, hermetic, and runnable in CI without infrastructure.

**When to write new tests:**  
After every phase/batch that adds new routes, changes auth patterns, or introduces structural contracts. The test files are named by phase — continue that pattern.

---

## Excluded Tests

Some tests are excluded from the default `pnpm test` run because they require live infrastructure:

`vite.config.ts` `test.exclude` is the source of truth. All 13 entries, and how each is run:

```
tests/restock.service.test.ts             — DATABASE_URL + migrations; pnpm exec tsx <file>
tests/migrations/**                       — DATABASE_URL + migrations; pnpm exec tsx <file>
tests/equipment-operational-state.integration.test.ts — pnpm test:db-integration / test:integration:ops
tests/shift-chat-window.integration.test.ts — DATABASE_URL; pnpm exec tsx <file>
tests/seed-reviewer-demo.integration.test.ts — pnpm test:db-integration
tests/doctor-shift-gate.integration.test.ts  — pnpm test:db-integration
tests/tenant-pooling-isolation.integration.test.ts — pnpm test:rls-pooling (real DDL, see below)
tests/charge-alert-worker.test.js         — requires dev server on :3001
tests/code-blue-mode-equipment.test.js    — requires dev server on :3001
tests/equipment-scan-e2e.test.js          — requires dev server on :3001
tests/expiry-api.test.js                  — requires dev server on :3001
tests/expiry-check-worker.test.js         — requires dev server on :3001
tests/returns-api.test.js                 — requires dev server on :3001
```

Dedicated runners:

```bash
pnpm test:db-integration    # vitest.db-integration.config.ts
pnpm test:integration:ops   # vitest.integration.ops.config.ts (operational-state + waitlist)
pnpm test:rls-pooling       # vitest.rls-pooling.config.ts — runs CREATE TABLE + RLS DDL.
                            # Needs RLS_POOLING_PROBE=1 and RLS_PROBE_DATABASE_URL
                            # (NOT DATABASE_URL) pointed at a throwaway database.
```

For the live-server suites, start the dev server first, then run the file directly:

```bash
# These six are standalone Node scripts (main() + process.exit), NOT vitest suites —
# `vitest run` on them collects zero tests and exits 0, which reads as a pass.
node tests/expiry-api.test.js          # or any of the other five
```

---

## CI

Tests run automatically on every push via `.github/workflows/ci.yml` (`pnpm test` + dual `tsc`). A failing test blocks merge.

**Program v2 default gates** (always in `pnpm test`, documented in CD-05 / `BUG_REGISTER.md`):

- `tests/phase-9-metrics-cardinality.test.ts`
- `tests/offline-phase-7-emergency-surface-parity.test.ts`
- `tests/multi-tenancy-hardening.test.js`

`release-gate.yml` additionally runs multi-tenancy, medication safety, and phase-5 error-contract suites on a schedule/manual dispatch.

---

## Adding Tests

1. Create `tests/<phase-or-feature>.test.js`
2. Import `describe`, `it`, `expect` from `vitest`
3. Read source files with `fs.readFileSync`
4. Assert structural properties (imports, middleware, patterns)

See `tests/integration-adapter.test.js` for a complete example of the preferred pattern.
