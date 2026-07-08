# Backend Codemap
<!-- Generated: 2026-07-08 | 48 route files, 249 routes, 23 services, 19 workers | Token estimate: ~750 -->

Express + TypeScript. Entry `server/index.ts` (imports `env-bootstrap` FIRST) → `server/app/routes.ts` registers **61 route modules** (**249** method+path pairs). Full inventory: [`docs/audit/routes.md`](../audit/routes.md).

## Request pipeline
```
env-bootstrap → helmet/CSP/HSTS → xss body sanitize → rate limiters
→ i18nMiddleware (req.locale) → auth.ts (req.authUser always set)
→ tenant-context (clinicId) → validate.ts (schema) → route handler
→ service → Drizzle (clinicId-filtered) → apiError() envelope on failure
```
- **Auth:** `middleware/auth.ts` — role from `vt_users.role` (never JWT); dev-bypass headers `x-dev-{role,user-id,clinic-id}-override` (dev-bypass mode only).
- **Rate limits:** 100/min global, 10/min scan, 20/min checkout/return.

## Route groups (`server/routes/*.ts`, 48 files)
| Group | Representative files |
|-------|----------------------|
| Infrastructure | `health`, `metrics`, `realtime`, `queue`, `push`, `users`, `support`, `uploads`, `storage` |
| Equipment | `equipment`, `equipment-operational-state`, `returns`, `rooms`, `folders`, `home-dashboard`, `whatsapp`, `equipment-copilot` |
| Emergency | `code-blue`, `crash-cart` |
| Shifts/ops | `shifts`, `shift-*`, `clinical-check-ins`, `admin-outbox-{dlq,health}` |
| Inventory | `inventory`, `containers`, `dispense`, `restock`, `purchase-orders` |
| Integrations | `integrations`, `webhooks` (inbound-only), `rfid` |
| Display/board | `display.ts` (snapshot; feeds `/board`) |

## Realtime (frozen — Phase 9)
`GET /api/realtime/stream` — one SSE conn/clinic, `id:` cursor from `vt_event_outbox.id`. Reconnect → HTTP `replay` after `Last-Event-ID`; pruned → `reset_state` → full snapshot. `KEEPALIVE` ~10s carries `{activeCodeBlueSessionId, stormHint}`. Publisher: `startEventOutboxPublisher`.

## Command board snapshot (Phase 4–5)
`server/services/equipment-command-board.service.ts::buildCommandBoardSnapshot` — single clinicId-filtered equipment query (+ rooms leftJoin) with **4 additive aggregates** (power/docks/waitlist/staging) via `Promise.all`, each `safeBlock(withTimeout(…, 1500ms))` so one failure degrades only its block (2500ms envelope never trips). `byLocation` aggregated from fetched rows.

## Workers + schedulers (`server/app/start-schedulers.ts`, 19 files)
BullMQ + Redis (optional in dev → `QUEUE_DISABLED_NO_REDIS`). `expiryCheck` (cron 08:00) · `chargeAlert` (delayed) · `integration.worker` · `staleCheckInSweep` · `staleTaskOwnershipSweep` · `notification.worker` · `startEventOutboxPublisher` · `startOutbox{Janitor,DlqScanner}` · `startCodeBlueReconciliationScanner`.

## Authority + enforcement
`resolveAuthority()` (`server/lib/authority.ts`): open `vt_clinical_check_ins` → shift-derived **Strategy A** (frozen safety net). Evaluators in `server/lib/authority/enforcement/` each `off|shadow|enforce` per-clinic. Audit via `logAudit()` (fire-and-forget; kinds ∈ closed `AuditActionType` union).

## Note (see TECH_DEBT_REGISTER)
`server/tests/*.test.ts` (security, shift-chat) run by **no** runner — outside every include glob. `test.ts`/`stability.ts`/`cursor-bug-fixer.ts` are dev/internal routes.
