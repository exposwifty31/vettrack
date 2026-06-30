# VetTrack — Architecture Overview

> Reverse-engineered from the current codebase (verified against actual imports, route
> registration, schema definitions, and scheduler wiring — not folder names alone).
> Companion to `CLAUDE.md` (operating doctrine) and `README.md` (onboarding).
>
> Uncertain or load-bearing-but-non-obvious areas are marked **⚠ note**.

VetTrack is a multi-tenant veterinary-hospital **operations** platform. The current,
in-scope domain is **physical asset operations**: equipment tracking, custody/waitlist,
operational-state lifecycle, Code Blue (emergency) workflows, crash-cart checks,
inventory/containers/dispense, shifts & scheduling, and external PMS integrations.

> **Scope reality check:** ER / patient / hospitalization / medication-formulary /
> pharmacy-forecast features were **removed** in migrations 142–143
> (`docs/scope-change-2026.md`). The `vt_appointments` table + `/api/appointments`
> route survive as the *unified task model* — the UI renders them as "Tasks / משימות".
> Frontend routes for `/patients`, `/er`, `/billing`, `/meds`, `/pharmacy-forecast`
> still exist **only as redirects** to equipment surfaces (`src/app/routes.tsx`).

---

## 1. System at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│  Clients                                                               │
│   • Browser PWA (React 18 + Vite, offline-first, RTL/Hebrew default)   │
│   • Capacitor native shell (iOS/Android) — same bundle, native auth    │
│   • Ward / Code-Blue display kiosks (read-mostly, SSE-driven)          │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS (REST) + SSE (/api/realtime/stream)
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Express API (server/index.ts → server/app/routes.ts, ~45 routers)    │
│   middleware chain: helmet/CSP → cors → compression → clerk →         │
│     global rate-limit → i18n → tenantContext → sessionContext         │
│   domain services · authority+enforcement · realtime outbox publisher │
└──────┬───────────────────────┬─────────────────────┬─────────────────┘
       │                       │                     │
       ▼                       ▼                     ▼
┌────────────┐        ┌─────────────────┐    ┌────────────────────┐
│ PostgreSQL │        │ Redis (BullMQ)  │    │ External PMS        │
│ Drizzle ORM│        │ workers +       │    │ adapters (priza,    │
│ ~100 vt_*  │        │ schedulers      │    │ vendor-x, generic)  │
│ tables     │        │ (optional dev)  │    │ inbound/outbound    │
└────────────┘        └─────────────────┘    └────────────────────┘
```

**Stack:** React 18 · Vite 7 · TypeScript 5.9 · wouter (routing) · TanStack Query ·
Zustand · Dexie (IndexedDB) · Express 4 · Drizzle ORM 0.45 · PostgreSQL (`pg`) ·
BullMQ 5 + ioredis · Clerk (auth) · Capacitor 8 (native) · Sentry · Vitest + Playwright.

---

## 2. Runtime entrypoints

| Entrypoint | File | Role |
|---|---|---|
| **API server** | `server/index.ts` | Express bootstrap. Imports `env-bootstrap` **first**, then Sentry (`instrument.ts`), validates env, builds middleware chain, registers routes, runs migrations, starts schedulers. Listens on `PORT` (default 3001). |
| **Route registration** | `server/app/routes.ts` | `registerApiRoutes(app)` mounts ~45 routers in 6 groups (order is significant). |
| **Schedulers/workers** | `server/app/start-schedulers.ts` | `startBackgroundSchedulers()` — runs after migrations, skipped in `NODE_ENV=test`. |
| **Frontend** | `src/main.tsx` → `src/App.tsx` → `src/app/routes.tsx` | React root, provider stack, SW registration, Clerk (native vs web), lazy route table. |
| **Notification worker (CLI)** | `server/workers/notification.worker.ts` | `pnpm worker` — standalone push fan-out (requires Redis). |
| **Migration runner** | `server/migrate.ts` / `scripts/run-migrations.ts` | `runMigrations()` at startup and via `pnpm db:migrate`. |
| **Native shell** | `capacitor.config.ts` + `ios/` `android/` | Capacitor wrapper around the built web bundle. |

**Boot sequence (server):** `env-bootstrap` → Sentry → `validateEnv()` → build Express app
→ health routes (bypass middleware) → helmet/CORS/compression → raw-body webhook mounts
(Clerk svix, integration HMAC, RFID) → `express.json()` → global XSS body sanitizer →
Clerk middleware (conditional) → `/api` limiter → i18n → tenant context → session context →
`registerApiRoutes` → SPA static (prod) → `app.listen` → `runMigrations()` →
`ensureClinicPhase2Defaults()` → `startBackgroundSchedulers()`.

---

## 3. Domain decomposition (functional, not folder-only)

### 3.1 Platform / Infrastructure (cross-cutting)

| Module | Responsibility | Key files | Consumers |
|---|---|---|---|
| **Env & bootstrap** | Load `.env.local` then `.env` before any import (OS env wins — `dotenv` never overwrites an existing var); validate. | `server/lib/env-bootstrap.ts`, `server/lib/envValidation.ts` | every server module |
| **Auth mode** | Resolve `dev-bypass` vs `clerk` at startup; decide Clerk middleware mount. | `server/lib/auth-mode.ts`, `server/middleware/auth.ts` (`sessionContextMiddleware`, sets `req.authUser`) | all routes |
| **Tenant context** | Resolve/attach `clinicId`; enforce per-request tenant scoping. | `server/middleware/tenant-context.ts` | all routes |
| **i18n** | `req.locale` from `Accept-Language`/`x-locale`; server-rendered error envelopes. | `lib/i18n/middleware.ts`, `server/lib/apiError.ts`, `locales/{en,he}.json` | all routes + frontend |
| **Rate limiting** | Global 100/min + scoped scan/checkout limiters. | `server/middleware/rate-limiters.ts` | `/api/*` |
| **Audit** | Fire-and-forget audit log with a **closed** `AuditActionType` union. | `server/lib/audit.ts` → `vt_audit_logs` | services, evaluators |
| **Metrics/telemetry** | Bounded-enum counters (`incrementMetric()`); no PII/high-cardinality. | `server/lib/metrics.ts`, `server/routes/metrics.ts`, `server/routes/realtime.ts` | realtime, enforcement |
| **DB access** | Drizzle pool + schema barrel. **Every query filters by `clinicId`.** | `server/db.ts`, `server/schema/*.ts`, `server/lib/postgresql.ts`, `db-resilience.ts` | services, routes |
| **Config crypto** | AES-256-GCM for integration creds in `vt_server_config`. | `server/lib/config-crypto.ts`, `server/lib/server-config.ts` | integrations |

### 3.2 Realtime transport (frozen)

| Concern | Detail | Key files |
|---|---|---|
| **SSE** | One connection per clinic: `GET /api/realtime/stream`. Events carry monotonic `id:` cursor from `vt_event_outbox.id`. | `server/routes/realtime.ts`, `server/lib/realtime.ts` |
| **Outbox publisher** | Drains `vt_event_outbox` → SSE subscribers; ordering authority. | `server/lib/event-publisher.ts` (`startEventOutboxPublisher`), `realtime-outbox.ts` |
| **Replay** | Reconnect replays rows after `Last-Event-ID`; pruned id → `reset_state:last_event_pruned` → client full resync. HTTP twin: `/api/realtime/replay`. | `server/routes/realtime.ts` |
| **Keepalive** | ~10s `KEEPALIVE` carrying `{activeCodeBlueSessionId, stormHint}`; routed to keepalive subscribers only (never invalidates caches). | `server/lib/code-blue-keepalive.ts` |
| **Outbox health** | Janitor (retention) + DLQ scanner. | `outbox-janitor.ts`, `outbox-dlq-scanner.ts`, `outbox-health.ts`, routes `admin-outbox-*.ts` |
| **Client wiring** | `useRealtime`, `useRealtimeReconciliation` (visibility/pageshow/online/freeze), `BroadcastChannel("vt_realtime_outbox_cursor")` cursor+build-tag+code_blue_seen gossip. | `src/hooks/useRealtime*.ts`, `src/lib/realtime.ts`, `event-reducer.ts` |

### 3.3 Equipment (core domain — the biggest surface)

| Submodule | Responsibility | Key files |
|---|---|---|
| **Equipment CRUD/list** | Assets, status, rooms, docks, QR. | `server/routes/equipment.ts`, `routes/equipment/*`, `routes/rooms.ts`, `routes/folders.ts` · pages `equipment-list.tsx`, `equipment-detail.tsx`, `new-equipment.tsx` |
| **Custody / waitlist** | Checkout/return, custody toggle, waitlist + reservation/promotion. | `services/equipment-waitlist.service.ts`, `equipment-custody-toggle.service.ts`, `lib/equipment-waitlist-promotion.ts`, `routes/equipment-waitlist.ts`, `routes/returns.ts` |
| **Operational state** | V1/V2 condition/staging/readiness lifecycle. | `services/equipment-operational-state.service.ts`, `equipment-readiness-rules.service.ts`, `routes/equipment-operational-state.ts` + workers (§3.10) |
| **Location inference** | Derive location from scans/RFID. | `services/equipment-location-inference.ts`, `routes/equipment-inference.ts` |
| **RFID** | Tag reads ingest + routing (raw-body mount). | `server/lib/rfid/*`, `rfid-ingest.ts`, `mount-rfid-routes.ts`, `routes/rfid.ts` |
| **Command board / display** | Ward board + equipment board snapshots (SSE-driven, cache-denylisted). | `services/equipment-command-board.service.ts`, `routes/display.ts` (`createDisplayRouter`) |
| **Asset Copilot + Evidence graph** | Explainable "where/why" answers with citation + AI-safety validation over an evidence graph. ⚠ note: hexagonal `server/domain/equipment/**` is the cleanest layer in the repo. | `server/domain/equipment/evidence/**`, `server/domain/equipment/copilot/**`, `services/asset-copilot-*.service.ts`, `routes/equipment-copilot.ts`, `lib/anthropic-client.ts` |

### 3.4 Safety surfaces — Code Blue & crash cart (frozen guarantees)

| Submodule | Responsibility | Key files |
|---|---|---|
| **Code Blue sessions** | Emergency session create/log/end/presence. **Online-only mutations**, server-confirmed end, no offline queueing, no optimistic termination. | `server/routes/code-blue.ts`, `lib/code-blue-*.ts`, pages `code-blue.tsx`, `code-blue-display.tsx`, `code-blue-history.tsx` |
| **Reconciliation** | Scanner sweeps unreconciled sessions (~30 min/session alerts). | `lib/code-blue-reconciliation-scanner.ts` |
| **Crash cart** | Checklist of crash-cart items/checks. | `routes/crash-cart.ts`, schema `vt_crash_cart_*`, page `crash-cart.tsx` |
| **Client block** | `classifyEmergencyEndpoint()` intercepts emergency mutations in the API client → loud toast + bounded counter; never persisted to IndexedDB. | `src/lib/offline-emergency-block.ts`, `src/core/use-cases/offline-emergency-block.ts` |

### 3.5 Authority & enforcement (Phase 2.5 → 5)

| Concern | Detail | Key files |
|---|---|---|
| **Authority resolver** | Single source of effective clinical authority. Order: open `vt_clinical_check_ins` row → shift-derived **Strategy A** legacy branch (byte-for-byte preserved, not retired). | `server/lib/authority.ts`, `authority-cache.ts`, `authority-roles.ts`, `check-in-resolution.ts`, `shared/authority.ts` |
| **Evaluator families** | Each `off \| shadow \| enforce` per-clinic w/ short TTL. `off` short-circuits; `shadow` runs+counters+audit, never denies; `enforce` may deny w/ stable reason code (call site rolls back txn). | `server/lib/authority/enforcement/*` — `stale`, `oprole`, `task-assignment`, `stale-task-ownership`, `code-blue-manager`, `clinical-invariant` |
| **Safety nets** | Resolver throw → degrade to `off` (CI-16/CI-20). `SMART_COP_VALIDATION_FAIL_OPEN` → fail-open w/ `clinical_invariant_fail_open` audit kind. | `server/middleware/authority.ts`, enforcement `config.ts` |

### 3.6 Inventory / dispense / procurement

| Submodule | Responsibility | Key files |
|---|---|---|
| **Containers/items** | Stocked containers + item catalog + prices. | `routes/containers.ts`, `inventory-items.ts`, `services/inventory.service.ts`, schema `inventory.ts` |
| **Dispense** | Dispense events w/ idempotency hash + order validation; emergency-dispense scan. | `routes/dispense.ts`, `services/dispense.service.ts`, `lib/dispense-idempotency-hash.ts`, `dispense-order-validation.ts` |
| **Restock** | Restock sessions/events. | `routes/restock.ts`, `services/restock.service.ts` |
| **Procurement** | Purchase orders + lines. | `routes/procurement.ts`, schema `vt_purchase_orders`, `vt_po_lines` |
| **Shadow inventory** | Background reconciliation scheduler. | `services/shadow-inventory.service.ts` |

### 3.7 Shifts, tasks, clinical check-in, chat

| Submodule | Key files |
|---|---|
| **Shifts/scheduling** | `routes/shifts.ts`, `admin-shifts.tsx`, schema `vt_shifts`, `vt_shift_sessions`, `vt_doctor_shifts` |
| **Tasks (unified model)** | `routes/tasks.ts`, `routes/appointments.ts`, `services/appointments.service.ts`, `task-intelligence.service.ts`, `task-automation.service.ts`, `task-recall.service.ts`; schema `vt_appointments`, `vt_tasks`; UI `pages/appointments.tsx` (`/equipment/tasks`) |
| **Clinical check-in** | `routes/clinical-check-in.ts`, `services/clinical-check-in.ts`, `vt_clinical_check_ins` |
| **Shift chat** | `routes/shift-chat.ts`, `lib/shift-chat-presence.ts`, `features/shift-chat/*`, schema `vt_shift_messages*` |
| **Alerts** | `lib/alert-engine.ts`, `alert-reminder.ts`, `routes/alert-acks.ts`, `pages/alerts.tsx`, `vt_alert_acks` |

### 3.8 External PMS integrations

| Concern | Detail | Key files |
|---|---|---|
| **Adapter layer** | Per-vendor adapters over a common `base`. | `server/integrations/adapters/{base,priza,vendor-x,generic-pms,local-sandbox,vendor-stubs}.ts` |
| **Inbound webhooks** | HMAC-over-raw-body verification, CIDR allowlist, idempotent processing. | `integrations/webhooks/{inbound.router,verify-signature,cidr,repository}.ts` (mounted before `express.json()`) |
| **Sync/conflict** | Canonical mapping + conflict engine + sync log/conflict tables. | `integrations/mappers/*`, `conflicts/{conflict-engine,repository}.ts`, schema `vt_integration_*` |
| **Resilience/rollout** | Circuit breaker, rate limits, guarded calls, staged rollout policy. | `integrations/resilience/*`, `integrations/rollout/*` |
| **Dashboard/health** | Integration health + dashboard cache. | `integrations/health/*`, `integrations/dashboard/*`, `routes/integrations.ts` |

### 3.9 Auth, account, push, support, storage

| Submodule | Key files |
|---|---|
| **Users / sync** | `routes/users.ts`, `services/user-sync.service.ts`, Clerk webhook `routes/webhooks.ts` |
| **Account deletion** | `services/account-deletion.service.ts` |
| **Apple sign-in (native)** | `lib/apple-auth.ts`, `vt_apple_oauth_tokens` (migration 155) |
| **Push** | `routes/push.ts`, `lib/push.ts` (VAPID), `workers/notification.worker.ts`, `vt_push_subscriptions` |
| **Support/uploads/storage** | `routes/{support,uploads,storage}.ts`, AWS S3 (`@aws-sdk/client-s3`), multer |

### 3.10 Background workers & schedulers (BullMQ + Redis)

All registered in `server/app/start-schedulers.ts`. Redis optional in dev
(`QUEUE_DISABLED_NO_REDIS`); required in production.

| Worker / scheduler | Trigger / cadence |
|---|---|
| `startEventOutboxPublisher` | continuous — drives SSE |
| `startOutboxJanitor` / `startOutboxDlqScanner` | outbox retention + DLQ health |
| `startJobRuntime` (`server/jobs/runtime.ts`) | expiry-check (daily 08:00), charge-alert (delayed), stale-checkin-sweep |
| `startIntegrationWorker` + schedule/retention crons | PMS sync events |
| `startTaskOwnershipBackfillWorker` / `startStaleTaskOwnershipSweepWorker` | task-ownership backfill + TTL sweep |
| `startShadowInventoryScheduler` | inventory reconciliation |
| `startCodeBlueReconciliationScanner` | unreconciled Code Blue sweep |
| `startEquipmentConditionStalenessWorker`, `startStagingExpiryWorker`, `startProcedureBoundReleaseWorker`, `startEquipmentWaitlistReservationWorker`, `startStaleCheckoutSweepWorker` | equipment operational-state lifecycle |
| `scanUnresolvedEmergencyDispenses` (`setInterval` 10 min) | escalating emergency-dispense alerts (30/60/120 min) |
| push/cleanup/notification/watchdog/system-health/alert-reminder schedulers | misc periodic ops |

### 3.11 Frontend architecture

| Layer | Responsibility | Key files |
|---|---|---|
| **Bootstrap** | React root, provider stack, SW registration (build-tag versioned), Clerk native vs web instance, chunk-load recovery. | `src/main.tsx`, `src/App.tsx`, `src/instrument.ts` |
| **Routing** | wouter `<Switch>`, all pages lazy-loaded, `AuthGuard`/`WebOnlyGuard`, legacy-path redirects. | `src/app/routes.tsx` |
| **Platform split** | `resolvePlatformTarget()`/`usePlatformTarget()` → `"mobile" \| "desktop" \| "marketing"` (Capacitor native or narrow touch viewport → mobile; auth/landing routes → marketing; else desktop). `PlatformRouter` wraps the route tree: `mobile` → `NativeShell` (safe-area, tab bar, scan FAB); `desktop`/`marketing` → passthrough (per-page web chrome). ⚠ note: prefer `@/app/platform` helpers over ad-hoc `isCapacitorNative()` in new code; `src/shared` is now just a redirect stub. | `src/app/platform/{index.ts,PlatformRouter.tsx}`, `src/native/*`, `src/desktop/*`, `src/shell/*` |
| **API client** | All server calls go through one typed module; emergency-endpoint classifier; auth-fetch. | `src/lib/api.ts` (~1090 LOC), `src/lib/api/`, `auth-fetch.ts`, `request-core.ts` |
| **Server state** | TanStack Query (`queryClient`, `query-keys/`). | `src/lib/queryClient.ts`, `src/lib/query-keys/` |
| **Offline / PWA** | Dexie cache + FIFO sync queue + circuit breaker; emergency-block; telemetry. | `src/lib/offline-db.ts`, `sync-engine.ts`, `offline-*.ts`, `public/sw.js` |
| **Hexagonal core (emerging)** | Framework-free entities/use-cases/ports + infrastructure adapters. ⚠ note: partial migration — most logic still lives in `src/lib`. | `src/core/**`, `src/infrastructure/**` |
| **Feature modules** | auth, containers, equipment, inventory, alerts, scan, settings, shift-chat, today, profile. | `src/features/*` |
| **UI primitives** | shadcn/Radix primitives + shared components. | `src/components/ui/*`, `src/components/*` |

---

## 4. Database schema (PostgreSQL, all tables `vt_`)

Definitions in `server/schema/*.ts` (barrel `server/schema/index.ts`, re-exported from
`server/db.ts`). **158 SQL migrations** in `migrations/` applied in order at startup.

| Schema file | Domain | Representative tables |
|---|---|---|
| `core.ts` | tenancy & identity | `vt_clinics`, `vt_users`, `vt_server_config` |
| `equipment.ts` | equipment + custody + ops state | `vt_equipment`, `vt_rooms`, `vt_docks`, `vt_equipment_waitlist`, `vt_staging_queue`, `vt_scan_logs`, `vt_equipment_rfid_reads`, `vt_unit_condition_states`, `vt_asset_types`, `vt_operational_metrics` |
| `tasks.ts` | unified task model | `vt_appointments`, `vt_tasks`, `vt_task_ownership_confirm_queue` |
| `inventory.ts` | inventory/dispense/procurement | `vt_containers`, `vt_container_items`, `vt_items`, `vt_dispense_events`, `vt_restock_*`, `vt_purchase_orders`, `vt_po_lines`, `vt_inventory_logs` |
| `er.ts` | Code Blue / crash cart | `vt_code_blue_sessions`, `vt_code_blue_log_entries`, `vt_code_blue_events`, `vt_code_blue_presence`, `vt_crash_cart_items`, `vt_crash_cart_checks` |
| `ops.ts` | shifts / outbox / audit / clinical | `vt_shifts`, `vt_shift_sessions`, `vt_doctor_shifts`, `vt_event_outbox`, `vt_clinical_check_ins`, `vt_audit_logs`, `vt_shift_messages`, `vt_idempotency_keys`, `vt_push_subscriptions`, `vt_scheduled_notifications` |
| `integrations.ts` | external PMS | `vt_integration_configs`, `vt_integration_sync_log(_archive)`, `vt_integration_sync_conflicts`, `vt_integration_webhook_events(_archive)`, `vt_integration_mapping_reviews` |

Generated inventory: `docs/audit/db.md` (`pnpm docs:audit`).

---

## 5. Dependency & interaction map

### 5.1 Request → response (typical mutation)

```
Client (src/lib/api.ts typed fn)
  → offline-emergency-block classifier (emergency? → block; else fetch/queue)
  → HTTPS → Express middleware chain (helmet→cors→clerk→limiter→i18n→tenant→session)
  → router (server/routes/*) → Zod validate (middleware/validate.ts)
  → authority middleware (resolveAuthority + evaluator off|shadow|enforce)
  → domain service (server/services/* or server/domain/*)
  → Drizzle (clinicId-scoped) → Postgres
  → write vt_event_outbox row (+ logAudit fire-and-forget)
  → outbox publisher → SSE (/api/realtime/stream) → all clinic clients
  → client event-reducer → TanStack Query cache invalidation → UI
```

### 5.2 Layering (allowed import direction)

```
routes  →  middleware  →  services / domain  →  lib  →  schema/db
   │                                  │
   └────────── integrations ──────────┘   (adapters call lib + schema only)

frontend:  pages → features → components → hooks → lib(api/offline/realtime)
           core (entities/use-cases/ports) ← infrastructure adapters  [emerging]
```

Architecture gates enforce this: **dependency-cruiser** (`.dependency-cruiser.cjs` +
known-violations baseline), **madge** (cycles, `architecture:cycles`),
`scripts/architecture/*` (tenant-query lint, route contract extraction, query-key audit),
and **knip** (dead code). Run via `pnpm architecture:gates`.

### 5.3 Shared infrastructure/services map

| Shared service | Used by |
|---|---|
| `server/db.ts` (pool + schema) | every route/service/worker |
| `server/lib/audit.ts` | services, evaluators, routes |
| `server/lib/event-publisher.ts` + `vt_event_outbox` | all realtime-emitting mutations |
| `server/lib/authority.ts` + enforcement | clinical mutation call sites |
| `server/lib/metrics.ts` (bounded counters) | realtime, enforcement, sync |
| `server/lib/redis.ts` + `queues/*` | all BullMQ workers |
| `lib/i18n/*` + `locales/*.json` | server error envelopes + frontend `t` |
| `src/lib/api.ts` | every frontend data call |
| `src/lib/queryClient.ts` + `query-keys` | every TanStack Query usage |
| `src/lib/offline-db.ts` + `sync-engine.ts` | offline mutation/read paths |

---

## 6. Cross-cutting invariants (do not weaken)

1. **Multi-tenancy:** every `vt_*` query filters by `clinicId`. Dev-bypass = `dev-clinic-default`.
2. **Role from DB:** `req.authUser.role` is read from `vt_users.role`, never JWT claims.
3. **Frozen realtime/PWA:** SSE + outbox cursor (not WebSockets/polling); emergency endpoints
   never cached; build-tag is the single SW cache-name source of truth.
4. **Emergency = online-only:** Code Blue mutations fail loud offline; server-confirmed end;
   no optimistic termination; no polling recovery.
5. **Authority envelope:** evaluators keep `off | shadow | enforce`; Strategy A preserved.
6. **Closed unions:** `AuditActionType` and all telemetry counters are closed enums — extend the union, never log/emit arbitrary strings.
7. **i18n:** no hardcoded user copy in `.ts/.tsx`; Hebrew lives only in `locales/*.json`;
   `appointmentsPage.*` namespace + `vt_appointments` table + `/api/appointments` route are frozen (copy renamed to "Tasks" only).

---

## 7. Obsolete / ambiguous / noteworthy areas

- **Removed domains as redirect stubs:** `/patients`, `/er`, `/billing`, `/meds`,
  `/pharmacy-forecast`, `/pending` in `src/app/routes.tsx` redirect to equipment surfaces.
  `server/schema/er.ts` was repurposed to **Code Blue / crash cart** (despite the file name).
- **Root-level scratch/planning docs:** many top-level `*.md` (e.g. `FLOW_MATRIX.md`,
  `INFRA_CLEANUP_PLAN.md`, `TEST_AUDIT.md`, `STRUCTURE_PLAN.md`) and two large `Archive*.zip`
  (~100 MB) are historical artifacts, not load-bearing. ⚠ The zip archives look like
  accidental check-ins — candidates for removal but out of scope for this analysis.
- **`vt_xxx` / `vendor-x` placeholders** appear in test/sandbox fixtures, not production tables.
- **Emerging hexagonal layer** (`src/core`, `src/infrastructure`, `server/domain`) coexists
  with the older `src/lib` / `server/services` style — migration is partial.
- **`src/shell` is a thin re-export/alias layer** over `src/native` + `src/desktop` (legacy);
  `src/shared/index.ts` is now only a redirect comment pointing at `@/app/platform`.
- **`cursor-bug-fixer` / `cursor-cloud-agents-client`** (`routes/cursor-bug-fixer.ts`,
  `lib/cursor-cloud-agents-client.ts`) are internal AI-agent tooling endpoints, not core product.

---

## 8. Verification notes

- Module list and route mounts verified against `server/app/routes.ts` (45 `app.use` mounts)
  and `server/index.ts` middleware order.
- Scheduler list verified against `server/app/start-schedulers.ts`.
- Table names extracted from `server/schema/*.ts` (`vt_*` literals); 158 files in `migrations/`.
- Frontend routes + guards verified against `src/app/routes.tsx`; bootstrap against `src/main.tsx`.
- Frozen-surface and enforcement semantics cross-checked against `CLAUDE.md` and confirmed
  present in `server/lib/authority/enforcement/*`, `server/lib/event-publisher.ts`,
  `src/lib/offline-emergency-block.ts`.
- Items marked **⚠ note** are inferences about intent/quality, not verified contracts.
```
