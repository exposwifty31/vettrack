# VetTrack — API Route Inventory

All routes registered in `server/app/routes.ts`. Generated 2026-06-09.

---

## Infrastructure

| File | Primary paths |
|------|--------------|
| `health.ts` | `GET /api/healthz`, `GET /api/health/ready` |
| `users.ts` | `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id` |
| `realtime.ts` | `GET /api/realtime/stream`, `GET /api/realtime/replay`, `GET /api/realtime/outbox-head`, `POST /api/realtime/telemetry` |
| `push.ts` | `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `POST /api/push/test` |
| `uploads.ts` | `POST /api/uploads` |
| `storage.ts` | `POST /api/storage/upload`, `GET /api/storage/:id` |
| `support.ts` | `POST /api/support/ticket`, `GET /api/support/tickets` |
| `audit-logs.ts` | `GET /api/audit-logs`, `GET /api/audit-logs/:id` |
| `metrics.ts` | `GET /api/metrics` |
| `queue.ts` | `GET /api/queue/status` |
| `test.ts` | `POST /api/test/data`, `DELETE /api/test/reset` (test env only) |
| `stability.ts` | `GET /api/stability/status` |
| `platform-capabilities.ts` | `GET /api/platform/capabilities` |
| `cursor-bug-fixer.ts` | `POST /api/admin/cursor-bug-fixer/trigger` |

---

## Equipment

| File | Primary paths |
|------|--------------|
| `equipment.ts` | `GET /api/equipment`, `POST /api/equipment`, `GET /api/equipment/:id`, `PATCH /api/equipment/:id`, `DELETE /api/equipment/:id` |
| `equipment/` | Nested route sub-modules (equipment sub-resources) |
| `equipment-copilot.ts` | `POST /api/equipment/:id/copilot/ask` |
| `equipment-operational-state.ts` | `GET /api/equipment-operational-state`, `PATCH /api/equipment-operational-state/:id` |
| `equipment-waitlist.ts` | `GET /api/equipment-waitlist`, `POST /api/equipment-waitlist`, `DELETE /api/equipment-waitlist/:id` |
| `rooms.ts` | `GET /api/rooms`, `POST /api/rooms`, `GET /api/rooms/:id`, `PATCH /api/rooms/:id` |
| `folders.ts` | `GET /api/folders`, `POST /api/folders`, `PATCH /api/folders/:id` |
| `returns.ts` | `POST /api/equipment/:id/return`, `GET /api/returns` |
| `rfid.ts` | `POST /api/rfid/read` (RFID gateway webhook) |
| `alert-acks.ts` | `POST /api/alert-acks`, `GET /api/alert-acks` |
| `activity.ts` | `GET /api/activity`, `GET /api/activity/:id` |
| `display.ts` | `GET /api/display/snapshot` (emergency bypass — never cached) |
| `home-dashboard.ts` | `GET /api/home/dashboard` |
| `operational-metrics.ts` | `GET /api/operational-metrics`, `POST /api/operational-metrics/event` |

---

## Emergency & Safety

| File | Primary paths |
|------|--------------|
| `code-blue.ts` | `POST /api/code-blue/sessions`, `POST /api/code-blue/sessions/:id/logs`, `PATCH /api/code-blue/sessions/:id/end`, `PATCH /api/code-blue/sessions/:id/presence`, `GET /api/code-blue/sessions/active` |
| `crash-cart.ts` | `GET /api/crash-cart/checks`, `POST /api/crash-cart/checks`, `GET /api/crash-cart/items` |

---

## Scheduling & Shifts

| File | Primary paths |
|------|--------------|
| `shifts.ts` | `GET /api/shifts`, `POST /api/shifts`, `GET /api/shifts/:id`, `PATCH /api/shifts/:id`, `GET /api/shifts/current` |
| `clinical-check-in.ts` | `POST /api/clinical/check-in`, `POST /api/clinical/check-out`, `GET /api/clinical/check-ins` |
| `shift-chat.ts` | `GET /api/shift-chat/:shiftId`, `POST /api/shift-chat/:shiftId/message`, `POST /api/shift-chat/:shiftId/message/:msgId/reaction` |

---

## Tasks & Appointments

| File | Primary paths |
|------|--------------|
| `appointments.ts` | `GET /api/appointments`, `POST /api/appointments`, `GET /api/appointments/:id`, `PATCH /api/appointments/:id`, `DELETE /api/appointments/:id` |
| `tasks.ts` | `GET /api/tasks`, `POST /api/tasks`, `GET /api/tasks/:id` |

---

## Inventory & Billing

| File | Primary paths |
|------|--------------|
| `containers.ts` | `GET /api/containers`, `POST /api/containers`, `GET /api/containers/:id`, `PATCH /api/containers/:id` |
| `inventory-items.ts` | `GET /api/inventory-items`, `POST /api/inventory-items`, `PATCH /api/inventory-items/:id` |
| `restock.ts` | `POST /api/restock/session/start`, `POST /api/restock/session/:id/finish`, `POST /api/restock/event` |
| `dispense.ts` | `POST /api/dispense`, `GET /api/dispense/:id` |
| `procurement.ts` | `GET /api/procurement/orders`, `POST /api/procurement/orders`, `PATCH /api/procurement/orders/:id`, `GET /api/procurement/orders/:id/lines` |

---

## Analytics & Admin

| File | Primary paths |
|------|--------------|
| `analytics.ts` | `GET /api/analytics/kpi`, `GET /api/analytics/trends`, `GET /api/analytics/shift-leaderboard` |
| `admin-outbox-health.ts` | `GET /api/admin/outbox/health`, `POST /api/admin/outbox/retry` |
| `admin-outbox-dlq.ts` | `GET /api/admin/outbox/dlq`, `POST /api/admin/outbox/dlq/:id/retry` |
| `admin-task-ownership.ts` | `GET /api/admin/task-ownership`, `POST /api/admin/task-ownership/resolve` |

---

## Integrations

| File | Primary paths |
|------|--------------|
| `integrations.ts` | `GET /api/integrations`, `POST /api/integrations/:id/sync`, `GET /api/integrations/:id/status` |
| `webhooks.ts` | `POST /api/webhooks/clerk` (Clerk user sync) |
| `whatsapp.ts` | `POST /api/whatsapp/webhook`, `GET /api/whatsapp/status` |

---

## Route count summary

| Category | Files |
|----------|-------|
| Infrastructure | 14 |
| Equipment | 14 |
| Emergency | 2 |
| Scheduling | 3 |
| Tasks | 2 |
| Inventory | 5 |
| Analytics/Admin | 4 |
| Integrations | 3 |
| **Total** | **47** |

---

## Frozen emergency routes (never cached, online-only)

Per CLAUDE.md and SW denylist:
- `GET /api/display/snapshot`
- `GET /api/code-blue/sessions/active`
- `GET /api/realtime/stream`
- `GET /api/realtime/replay`
- `GET /api/realtime/outbox-head`
- `POST /api/realtime/telemetry`
