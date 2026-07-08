# Architecture Codemap
<!-- Generated: 2026-07-08 | Source: verified against code | Token estimate: ~700 -->

VetTrack — veterinary hospital operations platform. **Four platform targets, one codebase.**

## System shape
```
                        ┌───────────────────────────┐
  iPhone/iPad (Capacitor)│                           │
  Web console (Vite)      ├─► React 18 SPA (port 5000)│
  Board / TV (kiosk)      │   src/app/platform seam   │
  Marketing (/signin…)    └──────────┬────────────────┘
                                     │ src/lib/api.ts (typed)
                                     ▼
                        Express + TS API (port 3001)
                        server/app/routes.ts (61 modules, 249 routes)
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                        ▼
      PostgreSQL (Drizzle)     BullMQ + Redis           SSE realtime
      64 tables, vt_*          19 workers/jobs          /api/realtime/stream
                                                        (outbox cursor)
```

## Platform routing seam (`src/app/platform/`)
`PlatformTarget = "mobile" | "desktop" | "marketing" | "board"`. Resolve order:
```
isCapacitorNative()? ─yes→ mobile (NativeShell)   ← native NEVER hits board
isMarketingPathname()? ─yes→ marketing
startsWith "/board"? ─yes→ board (BoardShell)      ← kiosk, wake-lock, self-heal
isTouchNarrow()? ─yes→ mobile
else → desktop
```
`PlatformRouter.tsx` dispatches shell; `WebOnlyGuard` fences desktop-dense surfaces.

## Layer boundaries
| Layer | Path | Rule |
|-------|------|------|
| Client domain (hexagonal, in-progress) | `src/core/` | pure TS, no framework imports |
| Client adapters | `src/infrastructure/` | implement `core/ports` |
| Shells | `src/native/`, `src/desktop/`, `src/board/` | one per platform |
| API boundary | `src/lib/api.ts` + `src/types/` | every endpoint typed both sides |
| Server routes | `server/routes/*.ts` (48) | registered in `server/app/routes.ts` |
| Server domain | `server/services/` (23), `server/domain/` | business logic |
| Data | `server/schema/*.ts` (9) → Drizzle | **every query filters `clinicId`** |

## Frozen contracts (never replace — see program-plan.md "Globally frozen")
SSE transport + outbox cursor · BroadcastChannel envelope · SW emergency-endpoint denylist · `__VT_BUILD_TAG__` · authority evaluators `off|shadow|enforce` + Strategy A · `AuditActionType` closed union · bounded-enum telemetry · he/en parity · clinicId-per-query · native builds only via `scripts/build-native-shell.sh`.

## Auth
`server/lib/auth-mode.ts`: **clerk** (JWT) or **dev-bypass** (hardcoded admin, `clinicId=dev-clinic-default`). Role always read from `vt_users.role`, never JWT. Hierarchy: admin 40 · vet 30 · senior_technician 25 · lead_technician 22 · vet_tech/technician 20 · student 10.

## Related maps
[`backend.md`](./backend.md) · [`frontend.md`](./frontend.md) · [`data.md`](./data.md) · [`dependencies.md`](./dependencies.md)
