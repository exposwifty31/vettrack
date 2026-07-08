# PF-02 — Hot-route N+1 investigation (PR-27)

> ⚠️ **Historical (pre-scope-change).** Dated 2026-05-21, before the June-2026 removal of ER/patient/medication/billing (see [`docs/scope-change-2026.md`](scope-change-2026.md)). The "ER board" / patient references below describe removed surfaces — read for the equipment-list N+1 method only, not as current architecture.

**Date:** 2026-05-21  
**Finding:** PF-02 (equipment list + ER board N+1 risk)  
**Outcome:** No handler changes in this PR — static review did not reproduce application-level N+1.

## Equipment list (`GET /api/equipment`)

- Single Drizzle query with `leftJoin` on `folders`, `rooms`, and `users` (`server/routes/equipment.ts`).
- `linkedAnimalId` / `linkedAnimalName` use correlated subqueries per row (SQL-level, not a loop of round-trips).

## ER board (`GET /api/er/board`)

- Delegates to `getErBoard` in `server/services/er-board.service.ts` (batch selects; no per-row `await` in route).

## Follow-up

If production profiling shows slow list loads, capture `EXPLAIN ANALYZE` on the equipment correlated subqueries first before adding joins.

**Runtime verification:** not run (no live load test in this environment).
