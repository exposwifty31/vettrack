# VetTrack — API Route Inventory

Routes derived from `server/app/routes.ts`, `server/index.ts`, and `server/routes/*.ts`.

Generated 2026-07-08. **248** unique method+path pairs.

---

## Infrastructure

| File | Sample routes |
|------|---------------|
| `audit-logs.ts` | `GET /api/audit-logs` |
| `cursor-bug-fixer.ts` | `GET /api/admin/cursor-bug-fixer/agents/:agentId`, `GET /api/admin/cursor-bug-fixer/agents/:agentId/runs/:runId`, `GET /api/admin/cursor-bug-fixer/config`, `POST /api/admin/cursor-bug-fixer/dispatch`, `POST /api/admin/cursor-bug-fixer/support-tickets/:id/dispatch` |
| `health.ts` | `GET /api/health`, `GET /api/health/data-integrity`, `GET /api/health/live`, `GET /api/health/ready`, `GET /api/health/ready/data-integrity`, `GET /api/health/ready/live` (+6 more) |
| `metrics.ts` | `GET /api/metrics` |
| `platform-capabilities.ts` | `GET /api/platform/capabilities` |
| `push.ts` | `DELETE /api/push/subscribe`, `PATCH /api/push/subscribe`, `POST /api/push/subscribe`, `POST /api/push/test`, `GET /api/push/vapid-public-key` |
| `queue.ts` | `GET /api/queue/dlq`, `POST /api/queue/dlq/:jobId/replay`, `GET /api/queue/metrics` |
| `realtime.ts` | `GET /api/realtime`, `GET /api/realtime/outbox-head`, `GET /api/realtime/replay`, `GET /api/realtime/stream`, `POST /api/realtime/telemetry` |
| `stability.ts` | `DELETE /api/stability/logs`, `GET /api/stability/logs`, `GET /api/stability/results`, `POST /api/stability/run`, `POST /api/stability/schedule`, `GET /api/stability/status` (+1 more) |
| `storage.ts` | `POST /api/storage/upload-url` |
| `support.ts` | `GET /api/support`, `POST /api/support`, `PATCH /api/support/:id`, `GET /api/support/unresolved-count` |
| `test.ts` | `POST /api/test/charge-alert/run`, `POST /api/test/create-scenario`, `POST /api/test/expiry-check/run`, `GET /api/test/notifications`, `GET /api/test/returns/:id`, `POST /api/test/run-scheduler` |
| `uploads.ts` | `POST /api/uploads/avatar`, `POST /api/uploads/fault-image` |
| `users.ts` | `GET /api/users`, `PATCH /api/users/:id/delete`, `PATCH /api/users/:id/display_name`, `PATCH /api/users/:id/restore`, `PATCH /api/users/:id/role`, `PATCH /api/users/:id/secondary-role` (+12 more) |

## Equipment

| File | Sample routes |
|------|---------------|
| `activity.ts` | `GET /api/activity`, `GET /api/activity/my-scan-count` |
| `alert-acks.ts` | `GET /api/alert-acks`, `POST /api/alert-acks`, `PATCH /api/alert-acks/:id/resolve` |
| `equipment-copilot.ts` | `POST /api/equipment/:id/copilot/explain` |
| `equipment-inference.ts` | `GET /api/equipment/:id/location-inference` |
| `equipment-operational-state.ts` | `GET /api/asset-types`, `POST /api/asset-types`, `GET /api/asset-types/:assetTypeId/conditions`, `POST /api/asset-types/:assetTypeId/conditions`, `GET /api/docks`, `POST /api/docks` (+8 more) |
| `equipment.ts` | `GET /api/equipment`, `POST /api/equipment`, `DELETE /api/equipment/:id`, `GET /api/equipment/:id`, `PATCH /api/equipment/:id`, `POST /api/equipment/:id/checkout` (+18 more) |
| `folders.ts` | `GET /api/folders`, `POST /api/folders`, `DELETE /api/folders/:id`, `PATCH /api/folders/:id` |
| `home-dashboard.ts` | `GET /api/home/dashboard` |
| `operational-metrics.ts` | `GET /api/operational-metrics/summary` |
| `returns.ts` | `POST /api/returns`, `PATCH /api/returns/:id` |
| `rooms.ts` | `GET /api/rooms`, `POST /api/rooms`, `DELETE /api/rooms/:id`, `GET /api/rooms/:id`, `PATCH /api/rooms/:id`, `GET /api/rooms/:id/activity` |
| `whatsapp.ts` | `POST /api/whatsapp/alert` |

## Emergency & safety

| File | Sample routes |
|------|---------------|
| `code-blue.ts` | `GET /api/code-blue/events`, `POST /api/code-blue/events`, `PATCH /api/code-blue/events/:id`, `GET /api/code-blue/history`, `GET /api/code-blue/reconciliation`, `POST /api/code-blue/sessions` (+7 more) |
| `crash-cart.ts` | `POST /api/crash-cart/checks`, `GET /api/crash-cart/checks/latest`, `GET /api/crash-cart/items`, `POST /api/crash-cart/items`, `DELETE /api/crash-cart/items/:id`, `PATCH /api/crash-cart/items/:id` |

## Scheduling & shifts

| File | Sample routes |
|------|---------------|
| `appointments.ts` | `GET /api/appointments`, `POST /api/appointments`, `DELETE /api/appointments/:id`, `PATCH /api/appointments/:id`, `GET /api/appointments/meta` |
| `clinical-check-in.ts` | `POST /api/clinical/check-in`, `POST /api/clinical/check-ins/:id/admin-force-close`, `POST /api/clinical/check-out`, `GET /api/clinical/me/active`, `GET /api/clinical/me/operational-roles` |
| `shift-chat.ts` | `GET /api/shift-chat/archive/:shiftId`, `GET /api/shift-chat/messages`, `POST /api/shift-chat/messages`, `POST /api/shift-chat/messages/:id/ack`, `POST /api/shift-chat/messages/:id/pin`, `POST /api/shift-chat/reactions` (+1 more) |
| `shifts.ts` | `GET /api/shifts`, `POST /api/shifts/import`, `POST /api/shifts/import/confirm`, `POST /api/shifts/import/preview`, `GET /api/shifts/imports` |
| `tasks.ts` | `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/start`, `GET /api/tasks/active`, `GET /api/tasks/dashboard`, `GET /api/tasks/me`, `GET /api/tasks/recommendations` |

## Inventory & procurement

| File | Sample routes |
|------|---------------|
| `containers.ts` | `GET /api/containers`, `POST /api/containers`, `POST /api/containers/:id/blind-audit`, `POST /api/containers/:id/dispense`, `POST /api/containers/:id/restock`, `POST /api/containers/bootstrap-defaults` (+1 more) |
| `dispense.ts` | `POST /api/dispense/:id/confirm`, `POST /api/dispense/draft`, `POST /api/dispense/emergency` |
| `inventory-items.ts` | `GET /api/inventory-items`, `POST /api/inventory-items`, `PATCH /api/inventory-items/:id`, `PATCH /api/inventory-items/:id/deactivate`, `GET /api/inventory-items/:id/detail`, `GET /api/inventory-items/:id/prices` (+1 more) |
| `procurement.ts` | `GET /api/procurement`, `POST /api/procurement`, `GET /api/procurement/:id`, `PATCH /api/procurement/:id/cancel`, `PATCH /api/procurement/:id/receive`, `PATCH /api/procurement/:id/submit` |
| `restock.ts` | `POST /api/restock/cancel`, `POST /api/restock/container-items`, `POST /api/restock/finish`, `POST /api/restock/scan`, `POST /api/restock/start` |

## Integrations

| File | Sample routes |
|------|---------------|
| `integrations.ts` | `GET /api/integrations/adapters`, `GET /api/integrations/analytics/product`, `GET /api/integrations/billing/mismatch-report`, `GET /api/integrations/configs`, `POST /api/integrations/configs`, `DELETE /api/integrations/configs/:adapterId` (+13 more) |

## Admin & analytics

| File | Sample routes |
|------|---------------|
| `admin-outbox-dlq.ts` | `GET /api/admin/outbox/dlq`, `POST /api/admin/outbox/dlq/drop`, `POST /api/admin/outbox/dlq/retry` |
| `admin-outbox-health.ts` | `GET /api/admin/outbox-health` |
| `admin-task-ownership.ts` | `POST /api/admin/task-ownership/backfill`, `GET /api/admin/task-ownership/backfill/:jobId`, `GET /api/admin/task-ownership/queue`, `POST /api/admin/task-ownership/queue/:id/confirm`, `POST /api/admin/task-ownership/queue/:id/reject`, `POST /api/admin/task-ownership/queue/:id/skip` (+1 more) |
| `analytics.ts` | `GET /api/analytics`, `GET /api/analytics/billing`, `GET /api/analytics/shift-completion` |

## Other

- `POST /api/integration-webhooks/:adapterId` (`server/integrations/webhooks/inbound.router.ts`)
- `POST /api/integrations/ops/runs/:runId/retry` (`server/integrations/routes/ops.routes.ts`)
- `POST /api/integrations/ops/sync/window` (`server/integrations/routes/ops.routes.ts`)
- `POST /api/integrations/ops/webhooks/:id/replay` (`server/integrations/routes/ops.routes.ts`)
- `GET /api/shift-adjustments` (`server/routes/shift-adjustments.ts`)
- `POST /api/shift-adjustments` (`server/routes/shift-adjustments.ts`)
- `PATCH /api/shift-adjustments/:id` (`server/routes/shift-adjustments.ts`)
- `POST /api/shift-adjustments/:id/cancel` (`server/routes/shift-adjustments.ts`)
- `POST /api/webhooks/clerk` (`server/routes/webhooks.ts`)
