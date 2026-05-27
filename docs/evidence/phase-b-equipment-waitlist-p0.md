# Phase B equipment waitlist — P0 evidence package (PR #491)

**Branch:** `cursor/equipment-waitlist-phase-b-e82a`  
**Migration:** `137_vt_equipment_waitlist.sql`  
**Date:** 2026-05-27  
**Latest verification (agent):** 2026-05-27 — commit `3b286389`

## 1. Paginated equipment list + SSE invalidation

### Client contract (vitest)

Six triggers invalidate paginated React Query keys via `applyEvent` → `invalidateEquipmentCaches`:

| Trigger | Outbox / event type |
|---------|---------------------|
| Return | `EQUIPMENT_CUSTODY_STATE_CHANGED` |
| Dock-return | `EQUIPMENT_DOCK_RETURN` |
| Waitlist join | `EQUIPMENT_WAITLIST_JOINED` |
| Waitlist leave | `EQUIPMENT_WAITLIST_LEFT` |
| Waitlist promote | `EQUIPMENT_WAITLIST_PROMOTED` |
| Reservation expiry | `EQUIPMENT_WAITLIST_EXPIRED` |

**Command:** `pnpm test -- tests/equipment-waitlist-paginated-sse.contract.test.ts`  
**File:** `tests/equipment-waitlist-paginated-sse.contract.test.ts`

### API-level Playwright (replay + paginated list)

Proves replay receives join/leave/return/promote events and `GET /api/equipment?limit=&page=` custody updates without manual refresh.

**Command:** `PW_SUITE=waitlist pnpm test:playwright:waitlist`  
**Prerequisites:** API on `:3001`, migration 137, dev-bypass (`CLERK_SECRET_KEY` unset), **`NODE_ENV=development`** so the outbox publisher runs (`NODE_ENV=test` disables schedulers; replay only returns published rows). Uses `dev-clinic-default` + `dev-user-alpha` / `dev-user-beta`.  
**File:** `tests/equipment-waitlist-sse.spec.ts`  
**Result (local 2026-05-27):** 1 passed (API replay + paginated custody), 1 skipped (browser shell when `TEST_BASE_URL` is API-only).

**Note:** Duplicate toast removed — only `EQUIPMENT_WAITLIST_PROMOTED` surfaces user toast; `EQUIPMENT_WAITLIST_AVAILABLE` invalidates caches only (replay compat).

## 2. Postgres integration tests

**Command:** `DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack pnpm test:integration:ops`

| Case | File |
|------|------|
| Return → promote + outbox | `equipment-waitlist.integration.test.ts` |
| Parallel promotion race → one `notified` | same |
| TTL expiry → next promote | same |
| Dock-return → promote chain | same |
| Join/leave outbox | same |
| Checkout fulfills notified row | same |
| Duplicate join → 409 | same (+ `isPostgresUniqueViolation` fix for Drizzle-wrapped 23505) |

**Result (local):** 61 passed (54 operational-state + 7 waitlist), migration 137 applied.

## 3. P1 UX

- `WaitlistPanel` on primary detail when another user has checkout (`equipment-detail.tsx`, above status card).
- Removed from Readiness-only placement.

## 4. P2 fast follow (this remediation)

- `expireNotifiedReservations` → `Promise<ExpiredWaitlistRow[]>`
- `pnpm typecheck` includes `tsconfig.server.json` (server + shared + lib)
- Push copy: `equipmentWaitlist.promotedTitle` / `promotedBody` via `translate()` + user `preferredLocale`

## CI reproduction

```bash
pnpm install
# Postgres 16 + vettrack DB; apply migrations through 137
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack pnpm db:migrate
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack pnpm test:integration:ops
pnpm test -- tests/equipment-waitlist
pnpm run typecheck
```

## Verification log (2026-05-27, commit 3b286389)

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | pass |
| `pnpm typecheck` | pass (client + `tsconfig.server.json`) |
| `pnpm test` | **4053 passed**, 36 skipped (310 files) |
| `pnpm test -- tests/equipment-waitlist*` | **13 passed**, 7 skipped (integration skipped without `test:integration:ops` config) |
| `pnpm test -- tests/equipment-waitlist-paginated-sse.contract.test.ts` | **6 passed** |
| `DATABASE_URL=... pnpm test:integration:ops` | **61 passed** (7 waitlist + 54 operational-state) |
| `PW_SUITE=waitlist pnpm test:playwright:waitlist` | **1 passed**, 1 skipped (browser list needs Vite :5000) |

### Two-browser proof (Playwright)

**File:** `tests/equipment-waitlist-two-browser.spec.ts`

Two isolated Playwright **browser contexts** (separate sessions), user A vs user B:

| Step | Context A | Context B |
|------|-----------|-----------|
| Checkout | API checkout | Opens `/equipment/:id`, **WaitlistPanel** visible, joins waitlist |
| List | — | `/equipment` paginated fetch shows `checked_out` |
| Return | API return | Replay sees `EQUIPMENT_WAITLIST_PROMOTED`; API `myStatus=notified` |
| List | — | Paginated fetch shows `returned` without manual refresh |

**Run:**

```bash
# Terminal 1: API (development, no Clerk secret)
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack PORT=3001 NODE_ENV=development \
  env -u CLERK_SECRET_KEY npx tsx server/index.ts

# Terminal 2: Vite
pnpm dev:web

# Terminal 3: test
TEST_BASE_URL=http://127.0.0.1:5000 PW_SUITE=waitlist pnpm exec playwright test \
  --config=playwright.config.ts --project=chromium tests/equipment-waitlist-two-browser.spec.ts
```

**Result (2026-05-27):** 1 passed (~2.5s).

Event assertions use `/api/realtime/replay` from browser B (same published outbox as SSE). After promote, detail **WaitlistPanel** hides because eligibility requires `checked_out`; reservation is proven via waitlist API + replay.

### API-only fallback

`equipment-waitlist-sse.spec.ts` — dual-user API replay when Vite is not running.
