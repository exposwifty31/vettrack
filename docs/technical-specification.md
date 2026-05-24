# VetTrack — Technical Specification

**Audience:** Software engineers implementing, reviewing, or operating VetTrack.  
**Version:** 1.1.1 (package.json) · **Last updated:** 2026-05-24  
**Canonical companions:** `README.md`, `CLAUDE.md`, `CONTEXT.md`, `AGENTS.md`

---

## 1. Purpose and scope

VetTrack is a **multi-clinic veterinary hospital operations platform**. It coordinates:

- **Asset tracking** — NFC/QR equipment checkout, returns, rooms, scan logs
- **Medication workflows** — dose calculation, task execution, formulary, billing linkage
- **Inventory and procurement** — containers, restock, dispense, purchase orders
- **Scheduling and tasks** — unified task model (`vt_appointments`; user-facing label **Tasks**)
- **Emergency and bedside** — Code Blue sessions, ward display, ER command center
- **Billing and usage** — ledger with idempotent keys, usage sessions
- **External PMS** — adapter-based integrations (webhooks, sync jobs)

This document describes **how the system is built and how subsystems interact**. It does not replace product specs in `docs/superpowers/specs/` or domain language in `CONTEXT.md`.

---

## 2. System context

```mermaid
flowchart TB
  subgraph clients [Clients]
    PWA[React PWA / Vite]
    SW[Service Worker]
    Dexie[IndexedDB Dexie]
  end

  subgraph api [API Tier]
    Express[Express :3001]
    Auth[Clerk / dev-bypass]
    MW[Middleware chain]
    Routes[~49 route modules]
    Svc[Domain services]
  end

  subgraph data [Data and async]
    PG[(PostgreSQL)]
    Redis[(Redis)]
    BullMQ[BullMQ workers]
    Outbox[vt_event_outbox]
  end

  PWA -->|HTTPS /api| Express
  PWA --> SW
  PWA --> Dexie
  Express --> Auth
  Auth --> MW --> Routes --> Svc
  Svc --> PG
  Svc --> Outbox
  Outbox -->|SSE publisher| PWA
  Svc --> BullMQ
  BullMQ --> Redis
  BullMQ --> PG
```

| Layer | Technology | Notes |
|--------|------------|--------|
| Frontend | React 18, Vite, TypeScript, wouter, TanStack Query | Port **5000** in dev |
| API | Express, TypeScript (ESM) | Port **3001**; `trust proxy` enabled |
| ORM | Drizzle | Schema **only** in `server/db.ts` |
| DB | PostgreSQL 16 | All tables prefixed `vt_` |
| Queues | BullMQ + Redis | Optional in dev; required in production |
| Auth | Clerk (`@clerk/express`, `@clerk/clerk-react`) | Dev-bypass without `CLERK_SECRET_KEY` |
| i18n | `locales/en.json`, `locales/he.json` | Hebrew default; typed `t.*` on client |
| Deploy | Railway (documented in README) | `pnpm build` → `dist/public` served by Express |

---

## 3. Repository layout

```
vettrack/
├── src/                    # React frontend
│   ├── app/routes.tsx      # All routes; React.lazy pages
│   ├── pages/              # Route-level screens (~56)
│   ├── features/           # Feature modules (auth, inventory, shift-chat, …)
│   ├── components/         # Shared UI (shadcn/Radix in components/ui/)
│   ├── hooks/              # Auth, offline sync, push, settings
│   └── lib/                # api.ts, offline-db.ts, sync-engine.ts, i18n.ts
├── server/
│   ├── index.ts            # Express bootstrap (env-bootstrap MUST be first import)
│   ├── db.ts               # Drizzle schema — single source of truth
│   ├── migrate.ts          # runMigrations() only
│   ├── app/
│   │   ├── routes.ts       # registerApiRoutes() — mount path registry
│   │   └── start-schedulers.ts
│   ├── routes/             # One Express router per resource (~53 files)
│   ├── services/           # Async functions; clinicId explicit param
│   ├── lib/                # Billing, audit, realtime, authority, queues, …
│   ├── workers/            # BullMQ consumers
│   └── integrations/       # PMS adapters, webhooks, sync jobs
├── shared/                 # Types/constants shared with frontend
├── migrations/             # Ordered SQL (drizzle-kit generate)
├── locales/                # en.json, he.json
├── lib/i18n/               # Shared i18n utilities (server + scripts)
├── tests/                  # Vitest; Playwright for E2E / Phase 9 drills
└── docs/                   # Runbooks, ADRs, this spec
```

**Registration sources of truth**

- HTTP APIs: `server/app/routes.ts` → `registerApiRoutes()`
- Background work: `server/app/start-schedulers.ts` → `startBackgroundSchedulers()`
- UI routes: `src/app/routes.tsx` → `AppRoutes`

---

## 4. Runtime bootstrap (server)

Boot order in `server/index.ts` (simplified):

1. `server/lib/env-bootstrap.ts` — loads `.env.local` then `.env`
2. `instrument.js` — Sentry
3. `validateEnv()` — production gate (`server/lib/envValidation.ts`)
4. Express middleware: health (early), helmet CSP, CORS, compression, Clerk, JSON + **recursive XSS** sanitizer (`xss` package)
5. `i18nMiddleware`, `tenantContext`, `erModeConcealmentMiddleware`, `sessionContextMiddleware`, rate limiters
6. Webhooks (raw body): Clerk, inbound integrations
7. `registerApiRoutes(app)`
8. Static assets / Vite proxy in dev
9. **`runMigrations()`** — failure aborts scheduler startup for that process
10. `startBackgroundSchedulers()`
11. In-process intervals: inventory job recovery (10 min), stale medication task release (5 min)

**Pilot mode:** `PILOT_MODE=true` registers a reduced API surface (equipment, safety, admin tooling); full platform routes are wrapped in `if (!isPilotMode)` in `routes.ts`.

---

## 5. Multi-tenancy (mandatory)

**`clinicId` is a security boundary.** Every Drizzle query that reads or writes tenant data must constrain the **target table** with `eq(<table>.clinicId, clinicId)` (or equivalent). Joining through a parent row is **not** sufficient if the queried table’s `clinicId` is not also filtered.

| Rule | Detail |
|------|--------|
| New tables | `clinicId` NOT NULL, FK to `vt_clinics`, immediately after PK in new definitions |
| Dev default | `dev-clinic-default` on `DEV_USER` — never hardcode in production-only paths |
| Cross-clinic access | Treat as **defect**, not style |

`sessionContextMiddleware` (on `/api`) best-effort sets `req.authUser`, `req.clinicId`, `req.locale`. Protected routes still require `requireAuth` (or stricter guards).

---

## 6. Authentication and authorization

### 6.1 Auth modes

| Mode | When | Config |
|------|------|--------|
| **clerk** | `CLERK_SECRET_KEY` set and `CLERK_ENABLED !== "false"` | Production standard |
| **dev-bypass** | No secret, or Clerk disabled | `DEV_USER` in `server/middleware/auth.ts` |

**Runtime resolution** (`resolveAuthUser` in `auth.ts`): dev-bypass when `NODE_ENV !== "production"` **and** `CLERK_SECRET_KEY` unset; otherwise Clerk. This can differ from `resolveAuthModeFromEnv()` when `CLERK_ENABLED=false` — **runtime behavior is authoritative** for handlers.

### 6.2 Role source of truth

After auth resolution, **`role` comes from `vt_users.role` in the database**, not JWT claims. Effective role for shift context may use `resolveCurrentRole` (`server/lib/role-resolution.ts`).

**Numeric hierarchy** (`ROLE_HIERARCHY`):

| Role | Floor |
|------|-------|
| admin | 40 |
| vet | 30 |
| senior_technician | 25 |
| lead_technician | 22 |
| vet_tech / technician | 20 |
| student | 10 |

### 6.3 Guards

| Middleware | Behavior |
|------------|----------|
| `requireAuth` | Active users; blocks `pending`, `blocked`, `deletedAt` |
| `requireAdmin` | `admin` only |
| `requireRole(minRole)` | Numeric floor |
| `requireEffectiveRole(minRole)` | Uses shift-aware role |

Account states: `pending` → 403 `ACCOUNT_PENDING_APPROVAL`; `blocked` → 403 `ACCOUNT_BLOCKED`.

**Dev-only headers** (dev-bypass only): `x-dev-role-override`, `x-dev-user-id-override`, `x-dev-clinic-id-override`.

### 6.4 ER Mode concealment

When a clinic is in ER Mode, `erModeConcealmentMiddleware` returns **404** for non-allowlisted routes (Concealment 404). Allowlist is clinic-scoped; see `CONTEXT.md` for ER Wedge terminology.

---

## 7. Data layer

### 7.1 Schema workflow

1. Edit `server/db.ts`
2. `npx drizzle-kit generate` → new file under `migrations/`
3. `pnpm db:migrate` (also runs at server startup via `runMigrations()`)
4. **`drizzle-kit push`** — local dev only, never production

### 7.2 Table families (representative)

| Domain | Tables (export names in `db.ts`) |
|--------|----------------------------------|
| Core | `users`, `clinics`, `owners`, `animals` |
| Tasks | `appointments` (`vt_appointments`; `taskType` includes `medication`) |
| Medication | `medicationTasks`, `drugFormulary`, `medTaskDoseEdits` |
| Equipment | `equipment`, `rooms`, `scanLogs`, `transferLogs`, `equipmentReturns` |
| Inventory | `inventoryItems`, `containers`, `containerItems`, `inventoryJobs`, `inventoryLogs` |
| Billing | `billingLedger`, `billingItems`, `usageSessions` |
| Emergency | `codeBlueSessions`, `codeBlueLogEntries`, `codeBlueEvents` (legacy) |
| ER | `erIntakeEvents`, `shiftHandoffs`, `erKpiDaily`, `doctorAdmissionState`, … |
| Authority | `clinicalCheckIns`, `taskOwnershipConfirmQueue` |
| Realtime | `eventOutbox` |
| Integrations | `integrationConfigs`, `integrationSyncLog`, `integrationWebhookEvents`, … |
| Ops | `auditLogs`, `pushSubscriptions`, `serverConfig`, `purchaseOrders`, … |

**Soft delete:** pattern `deletedAt` / `deletedBy` on several entities; default queries use `isNull(deletedAt)`.

**Optimistic locking:** `vt_equipment.version` — updates must respect version where enforced.

**Idempotency:** `vt_billing_ledger.idempotency_key` NOT NULL UNIQUE; deterministic keys on insert.

### 7.3 JSONB

Pass structured objects through Drizzle (`calculationSnapshot`, `metadata`, audit payloads). Do not concatenate user input into JSON strings.

---

## 8. Service layer conventions

- Location: `server/services/*.service.ts` (and related modules)
- **Exported async functions only** — no service classes
- **`clinicId` is always an explicit parameter** — never read from `process.env` inside services
- Return typed DTOs or throw domain errors (`MedTaskError`, `MedicationCalculationError`, `InventoryError`, …)
- Multi-step writes: `await db.transaction(async (tx) => { ... })`

### 8.1 Audit logging

`logAudit()` from `server/lib/audit.ts`:

- Without `tx`: fire-and-forget (do not `await` on hot paths)
- With `tx`: returns Promise; audit + outbox in same transaction when commit must be atomic

`AuditActionType` is a **closed union** — new kinds must be added to the union, never inferred strings.

### 8.2 Transactional event outbox

`insertRealtimeDomainEvent(tx, { clinicId, type, payload, ... })` in `server/lib/realtime-outbox.ts` must run **in the same transaction** as the domain write when rollback must not publish.

Publisher: `server/lib/event-publisher.ts` — `POLL_MS = 750`, `BATCH_SIZE = 100`. **Do not add a second publisher loop.**

Consumers subscribe to `outboxEmitter`; do not poll `vt_event_outbox` for live UX.

---

## 9. API layer

### 9.1 Route modules

Each file under `server/routes/` exports an Express `Router`. Typical pattern:

```typescript
router.use(requireAuth);
router.get("/", async (req, res) => {
  const clinicId = req.clinicId!; // from session / tenant middleware
  // ...
});
```

Errors: `apiError()` (`server/lib/apiError.ts`) for localized JSON envelopes using `req.locale`.

### 9.2 Rate limiting (`server/middleware/rate-limiters.ts`)

| Limiter | Limit |
|---------|-------|
| Global API | 120 / min |
| Scan | 10 / min |
| Checkout / return | 20 / min |

Add scoped limiters for new sensitive writes.

### 9.3 Frontend API client

**All browser API traffic** goes through `src/lib/api.ts` (`request<T>`, typed helpers). No raw `fetch()` in feature code.

| Constant | Value |
|----------|-------|
| `FETCH_TIMEOUT_MS` | 30_000 |
| `EQUIPMENT_LIST_FETCH_TIMEOUT_MS` | 5_000 |
| `TASKS_FETCH_TIMEOUT_MS` | 5_000 |

**401:** `authRedirectInProgress` guard + navigate to `/signin`.

**Offline:** when `request()` is called with offline options and failure is network-related, mutations enqueue `pendingSync` via `offline-db.ts` — except **emergency endpoints** (see §12).

New endpoints require: handler in `server/routes/`, mount in `routes.ts`, export in `api.ts`, types in `src/types/` and/or `shared/`.

---

## 10. Key domain workflows

### 10.1 Medication task completion

```mermaid
sequenceDiagram
  participant UI
  participant API
  participant DB
  participant Queue
  participant Worker

  UI->>API: completeTask
  API->>DB: transaction (task + billing)
  API->>DB: insert inventory_jobs row
  API-->>UI: 200 (billing committed)
  API->>Queue: enqueue deduction job
  Worker->>DB: process deduction
  Note over UI,Worker: Brief billing/inventory skew is expected
```

- **Liquid volume:** `volumeMl = (weightKg * prescribedDoseMgPerKg) / concentrationMgPerMl`; must be **&lt; 100** ml (strict), &gt; 0, ≤ 2 decimal places
- **Routes:** `IV`, `IM`, `PO`, `SC` (uppercase)
- **Duplicate open tasks:** partial unique index + service check; `23505` handling
- **Recovery:** `recoverPendingInventoryJobs` every 10 minutes (pending &gt; 5 min or failed under retry cap)

### 10.2 Equipment scan / checkout

Scan flows write `vt_scan_logs`; checkout/return update `vt_equipment` with version checks where applicable. Offline scans queue via sync engine (`PendingSyncType`: `scan`, `checkout`, `return`, …).

**Charge alert:** return with `isPluggedIn=false` schedules BullMQ job `plug-check-${returnId}`; cancel via `cancelChargeAlertJob`.

### 10.3 Dispense and Smart COP

`server/lib/dispense-order-validation.ts` and enforcement evaluators validate dispense lines against orders/hospitalization. **Authoritative blocks** happen at HTTP mutation boundaries; UI banners alone are insufficient.

Evaluator families under `server/lib/authority/enforcement/`: each resolves per-clinic mode **`off | shadow | enforce`**.

- `off` — wiring short-circuited
- `shadow` — runs, never denies; sampled audit
- `enforce` — may deny with stable reason code (e.g. 422 `ORPHAN_DISPENSE_BLOCKED`)

`resolveAuthority()` (`server/lib/authority.ts`): clinical check-in row first; else **Strategy A** shift-derived path (unchanged legacy behavior).

### 10.4 ER intake and handoff

- Intake escalation: `scanErIntakeEscalations` every **60 s**; bumps `low → medium → high` when `escalatesAt <= now`
- Handoff SLA: **60 minutes**; scan every **5 minutes**
- Config: `clinics.erIntakeEscalateLowMinutes` / `erIntakeEscalateMediumMinutes` (defaults 15)

See `CONTEXT.md` for admission pool, **In Admission**, and structured handoff semantics.

---

## 11. Background workers and schedulers

All production workers/schedulers are started from `server/app/start-schedulers.ts` (no-op when `NODE_ENV === "test"`).

| Component | Role |
|-----------|------|
| `startEventOutboxPublisher` | Drains `vt_event_outbox` → SSE |
| `startOutboxJanitor` / `startOutboxDlqScanner` | Retention + DLQ health |
| `startInventoryDeductionWorker` | Post-`completeTask` deductions |
| `startChargeAlertWorker` | Plugged-in charge reminders |
| `startExpiryCheckWorker` | Cron `0 8 * * *` |
| `startIntegrationWorker` | PMS sync events |
| `startAdmissionFanoutWorker` | New-patient routing |
| `startStaleCheckInSweepWorker` | Clinical check-in TTL |
| `startStaleTaskOwnershipSweepWorker` | Task ownership TTL |
| `startTaskOwnershipBackfillWorker` | One-shot backfill |
| `startCodeBlueReconciliationScanner` | Unreconciled sessions |
| ER schedulers | KPI rollup, handoff SLA, intake escalation |
| In-process | Emergency dispense scan (10 min), inventory recovery (10 min) |

**Redis:** `createRedisConnection()` / `getRedisUrl()` — if unavailable, workers log disabled; production expects Redis.

**Adding a worker:** create `server/workers/foo.ts` with `startFooWorker()`, **`await` import and call** in `start-schedulers.ts`, ensure `queue.add` producers exist.

---

## 12. Realtime, Code Blue, and PWA (frozen surfaces)

These are **load-bearing contracts** (Phase 9). Extend additively; do not replace transport or weaken guarantees.

### 12.1 Realtime (SSE)

| Topic | Contract |
|-------|----------|
| Transport | **SSE only** — `GET /api/realtime/stream` (one connection per clinic) |
| Ordering | Monotonic `id:` from `vt_event_outbox` |
| Replay | `Last-Event-ID` or `GET /api/realtime/replay?after=` |
| Pruned cursor | `reset_state:last_event_pruned` → full snapshot resync |
| Cross-tab | `BroadcastChannel("vt_realtime_outbox_cursor")` — cursor, build tag, `code_blue_seen` |
| Keepalive | ~10 s; `{ activeCodeBlueSessionId, stormHint }`; does not invalidate query caches |
| Telemetry | `POST /api/realtime/telemetry` — **bounded enums only** |

### 12.2 Code Blue

- Mutations (`POST /sessions`, logs, end, presence) require **online** execution
- `src/lib/offline-emergency-block.ts` blocks offline queueing; loud toast + bounded counter
- Session end is **server-confirmed** — no optimistic local termination
- Recovery: replay + snapshot reconciliation — **no polling fallback** for emergency state

### 12.3 PWA / Service Worker

- Build tag: `__VT_BUILD_TAG__` → cache name `vettrack-<buildTag>`
- **Emergency denylist** (never cached): `/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/{stream,replay,outbox-head,telemetry}`
- `main.tsx`: global `ChunkLoadError` handler — single strategy, no per-page duplicates

---

## 13. Frontend architecture

### 13.1 Routing

- **Router:** wouter (`src/app/routes.tsx`)
- **Pages:** lazy-loaded `import("@/pages/...")`
- **Guards:** `AuthGuard`, `ErModeGuard`, pilot conditionals (`isPilotMode`)

### 13.2 State and data

- **Server state:** TanStack Query (`@tanstack/react-query`)
- **Auth:** `@clerk/clerk-react` + `useAuth` hook (dev may lack publishable key; API still works with dev-bypass)
- **Realtime reconciliation:** `useRealtimeReconciliation` — visibility, BFCache, online, freeze/resume

### 13.3 UI stack

- shadcn/Radix primitives in `src/components/ui/`
- Tailwind utilities
- Lucide icons
- Framer Motion for motion
- RTL: Hebrew locale; no Hebrew in TS/TSX source (JSON only)

### 13.4 Terminology freeze

User-facing copy: **Tasks / משימות**. Internal names remain: `vt_appointments`, `/api/appointments`, `appointmentsPage.*` i18n keys.

---

## 14. Offline-first

| Component | Responsibility |
|-----------|----------------|
| `src/lib/offline-db.ts` | Dexie v3/v4 — equipment, rooms, folders, `pendingSync` |
| `src/lib/sync-engine.ts` | FIFO replay, retries, circuit breaker |
| `src/lib/api.ts` | Enqueue on network failure when `offline` options set |

**Sync engine constants:** `MAX_RETRIES = 5`; `RETRY_DELAYS_MS = [2000, 5000, 10000]` (last value reused); `CIRCUIT_THRESHOLD = 5`; `CIRCUIT_COOLDOWN_MS = 20_000`; `ITEM_TIMEOUT_MS = 30_000`.

Each `PendingSyncType` must have a producer and processor path.

---

## 15. Internationalization

| Locale | File | Default |
|--------|------|---------|
| Hebrew | `locales/he.json` | Yes |
| English | `locales/en.json` | |

- Frontend: `import { t } from "@/lib/i18n"` → `src/lib/i18n.generated.d.ts` (codegen via `pnpm i18n:generate-types`)
- Parity: `pnpm i18n:check` / `tests/i18n-parity.test.ts`
- `_meta.*` keys: non-rendering; stripped at runtime
- Backend errors: `apiError()` + `req.locale` from `Accept-Language` / `x-locale`

---

## 16. External integrations

Location: `server/integrations/`

| Area | Path |
|------|------|
| Adapters | `adapters/*.ts` (vendor-x, priza, generic-pms, local-sandbox) |
| Canonical contract | `contracts/canonical.v1.ts` |
| Webhooks | `webhooks/inbound.router.ts` + signature verification |
| Jobs | `jobs/integration-schedules.ts`, `integration-retention.ts` |
| Credentials | AES-256-GCM when `DB_CONFIG_ENCRYPTION_KEY` set (`credential-manager.ts`) |

Inbound webhooks mount separately in `server/index.ts` (raw body). Feature flags and rollout policy under `integrations/rollout/`.

---

## 17. Security summary

| Control | Implementation |
|---------|----------------|
| XSS | Recursive `xss()` on JSON body post-`express.json()` |
| CSP / HSTS | Helmet in `server/index.ts` |
| Secrets at rest | `DB_CONFIG_ENCRYPTION_KEY` for integration config |
| Webhooks | Signature verification before trust |
| Integration CIDR | `integrations/webhooks/cidr.ts` where applicable |
| Sentry | `server/instrument.js`, React SDK on client |

---

## 18. Environment variables (essentials)

See `.env.example` for the full list. Production boot (`validateEnv`) requires at minimum:

- `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`
- `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`
- `ALLOWED_ORIGIN`, `DB_CONFIG_ENCRYPTION_KEY`

Minimal local dev:

```env
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
SESSION_SECRET=dev-session-secret-for-local-development
NODE_ENV=development
```

Commands: `pnpm dev` (API + Vite), `pnpm db:migrate`, `npx tsc --noEmit`, `pnpm test`, `pnpm validate:prod`.

---

## 19. Testing strategy

| Suite | Command | Notes |
|-------|---------|-------|
| Unit / integration | `pnpm test` | Vitest; DB tests excluded by default in `vite.config.ts` |
| Typecheck | `npx tsc --noEmit` | Required before merge |
| i18n | parity + no-Hebrew-in-source tests | |
| Phase 9 contracts | `tests/phase-9-deterministic-drills.test.ts` | Bounded telemetry counters |
| Phase 9 browser | `tests/phase-9-drills.spec.ts` | Requires running app |
| Playwright CI | `pnpm test:playwright:ci` | Chromium |
| Knip | per `knip.json` | Dead export detection after removals |

Live-server and DB integration tests need `DATABASE_URL`, migrations, and sometimes Redis or `:3001` API.

---

## 20. How to add a feature (checklist)

1. Schema in `server/db.ts` → `npx drizzle-kit generate` → commit SQL → `pnpm db:migrate`
2. Service functions in `server/services/` with explicit `clinicId`
3. Route in `server/routes/` → register in `server/app/routes.ts`
4. If BullMQ worker → `server/workers/` + `start-schedulers.ts`
5. `src/lib/api.ts` + `src/types/` (+ `shared/` if shared contract)
6. Page in `src/pages/` → lazy route in `src/app/routes.tsx`
7. Locale keys in **both** `locales/en.json` and `locales/he.json`
8. New audit kind → `AuditActionType` union
9. New realtime telemetry → bounded enum client + `server/routes/realtime.ts` + `incrementMetric()` union
10. `npx tsc --noEmit`; `pnpm test`; `knip` after removals

**Removal protocol (order):** UI → `routes.tsx` → `api.ts` → types → server routes → unregister router → services → worker → DB migration → locale keys → `knip` + tsc.

---

## 21. Operational doctrine (do not)

- Replace SSE with WebSockets or ad-hoc polling for domain events
- Queue Code Blue mutations offline
- Poll for Code Blue recovery instead of replay + reconciliation
- Optimistically end Code Blue sessions locally
- Add free-form/high-cardinality telemetry (IPs, UAs, raw timestamps)
- Weaken `off | shadow | enforce` or remove Strategy A authority fallback
- Cache emergency endpoints in the Service Worker
- Rename `vt_appointments` / `/api/appointments` / `appointmentsPage.*` internally

---

## 22. Reference documents

| Document | Use when |
|----------|----------|
| `CONTEXT.md` | ER Wedge, Smart COP, domain glossary |
| `CLAUDE.md` | Agent/engineering rules, frozen surfaces |
| `docs/cloud-agent-starter-skill.md` | Cloud VM setup, auth modes |
| `docs/dev-signin-runbook.md` | Local Clerk / HTTPS proxy |
| `docs/migrations.md` | Migration operations |
| `docs/integrations-guide.md` | PMS integration overview |
| `docs/engineering-rules-rollout.md` | `.cursor/rules/*.mdc` rationale |
| `docs/architecture/adr-*.md` | Specific ADRs |
| `docs/superpowers/specs/` | Feature design specs |

---

## 23. Document history

| Date | Change |
|------|--------|
| 2026-05-24 | Initial engineer-facing technical specification |
