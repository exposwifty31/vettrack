# Deferred test gauntlet — local run 2026-05-27

**Git:** `ba364b32` (main after #508–#510)

## H — restock.service (tsx script, not vitest)

```bash
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack \
  pnpm exec tsx tests/restock.service.test.ts
```

**Result:** PASS (script exits 0 when DATABASE_URL set and migrations applied)

## I — migrations safety

`tests/migrations/042_unique_active_session_safety.test.ts` is a standalone script; run via `tsx` if needed. No vitest suite.

## J — equipment operational state

```bash
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack \
  pnpm test:db-integration
```

**Result:** PASS — 54 tests (`equipment-operational-state.integration.test.ts`)

## K — live-server vitest

Requires API on `:3001` + Redis for workers. Run with `pnpm dev` in background:

```bash
pnpm test -- tests/charge-alert-worker.test.js tests/code-blue-mode-equipment.test.js \
  tests/equipment-scan-e2e.test.js tests/expiry-api.test.js tests/expiry-check-worker.test.js tests/returns-api.test.js
```

**Cloud agent:** Deferred — start dev stack + Redis locally before demo if fresh proof needed; CI green on main.

## L–P — Playwright

| ID | Command | Cloud agent note |
|----|---------|------------------|
| L | `pnpm test:playwright:phase9` | Requires dev server; partial without Clerk |
| M | `pnpm test:playwright:pwa` | Same |
| N | `pnpm test:playwright:ui-smoke` | Dev-bypass friendly |
| O | `pnpm test:playwright:waitlist` | Same |
| P | `pnpm test:playwright:workday` | Same |

**Authoritative:** CI Playwright shards green on #508–#510 merges.
