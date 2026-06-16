# Backend routing

## Route contract (G5, warn mode)

Generated snapshot: `docs/architecture/routes-contract.json` (method, full mounted path, source file/line).

```bash
pnpm routes:contract                              # warn on drift vs contract
pnpm routes:contract -- --write-contract          # refresh baseline after intentional route changes
pnpm docs:audit                                   # regenerate docs/audit/routes.md
```

## Registration (source of truth)

- **Mount registry:** `server/app/routes.ts` → `registerApiRoutes()`
- **Route modules:** `server/routes/*.ts` (~44 modules)
- **Also mounted from index:** `webhooks`, inbound integration webhooks, `rfid`

Pilot mode gating was **removed** — all registered routes mount unconditionally.

## Middleware stack (order-sensitive)

See [tenant-enforcement.md](./tenant-enforcement.md). Protected routes use `requireAuth` (and often `requireRole` / `requireEffectiveRole`).

## Workers & schedulers

- **Job runtime:** `server/jobs/runtime.ts` — BullMQ workers (charge-alert, expiry-check, stale-checkin-sweep, …)
- **In-process schedulers:** `server/app/start-schedulers.ts` — outbox publisher, equipment waitlist TTL, Code Blue reconciliation, integration workers, etc.
- **CLI notification worker:** `pnpm worker` → `server/workers/notification.worker.ts`

New workers must be registered in `start-schedulers.ts` (or job runtime definitions) in the same PR.

## Integrations (reference)

`server/integrations/` separates adapters, webhooks, and repository patterns — use as template for new external systems.

## Asset Copilot

`POST /api/equipment/:id/copilot/explain` — nested on equipment router via `equipment-copilot.ts`.
