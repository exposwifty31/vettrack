# Backend routing

## Registration (source of truth)

- **Mount registry:** `server/app/routes.ts` → `registerApiRoutes()`
- **Route modules:** `server/routes/*.ts` (55 files)
- **Also mounted from index:** `webhooks`, `integrations/webhooks/inbound`, `rfid`

Approximate count: **~49 API routers** under `/api/*` plus health/webhooks.

## Pilot mode gating

`resolveEffectiveRuntimePilotMode()` controls a block of mounts (analytics, shifts, appointments, tasks, containers, billing, etc.). Equipment, Code Blue, ER, realtime, admin outbox, formulary, and forecast stay registered.

**Refactor rule:** splitting `routes.ts` must preserve exact paths and the `if (!isPilotMode)` block semantics.

## Middleware stack (order-sensitive)

See [tenant-enforcement.md](./tenant-enforcement.md). Protected routes use `requireAuth` (and often `requireRole` / `requireEffectiveRole`).

## Current anti-pattern

Many route files import `../db` directly and embed business logic:

| File | ~Lines | Direct `db.*` in route |
|------|-------:|------------------------|
| `equipment.ts` | 2,938 | Yes (18+) |
| `equipment-operational-state.ts` | 764 | Yes (27+) |
| `containers.ts` | 1,277 | Yes |
| `billing.ts` | 1,018 | Yes |

**Target per domain:**

```
server/routes/domains/<domain>/
  <domain>.router.ts      # app.METHOD paths only
  <domain>.handlers.ts    # req/res adaptation
  <domain>.validation.ts  # zod/schemas
```

Services/repositories called from handlers — not from router wiring file.

## Workers & schedulers

- **Workers:** `server/workers/*.ts` — must be started in `server/app/start-schedulers.ts`
- **BullMQ job IDs / queue names:** contracts (e.g. `plug-check-${returnId}`) — do not rename during route modularization

## Integrations (reference)

`server/integrations/` already separates adapters, webhooks, rollout, and `repository.ts` patterns — use as a template for new repository extractions.

## Safe first backend extractions

1. Group-only refactor of `registerApiRoutes` (no path changes)
2. ADR-002 service split (no route path changes)
3. Handler extraction from a single domain router (equipment last or in phases)

## Verification per route change

- `npx tsc --noEmit`
- Ripgrep route paths unchanged: `rg 'app\.(get|post|patch|put|delete)\(' server/routes/...`
- Live-server tests if available for that resource (`tests/*-api.test.js`)
