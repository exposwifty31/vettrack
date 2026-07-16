 # VetTrack

  Multi-tenant **veterinary-hospital operations platform**. The current product scope is
  physical-asset operations: equipment tracking & custody, waitlist and operational-state
  lifecycle, Code Blue (emergency) workflows, crash-cart checks, inventory / dispense,
  shifts & scheduling, and external PMS integrations. It ships as an offline-first PWA and a
  Capacitor native iOS/Android shell that runs the same web bundle.

  > **Scope note:** ER / patient / hospitalization / medication-formulary / pharmacy-forecast
  > features were removed in migrations 142–143 (`docs/scope-change-2026.md`). The
  > `vt_appointments` table is the **unified task model**, rendered in the UI as
  > "Tasks / משימות". Legacy routes (`/patients`, `/er`, `/billing`, `/meds`) survive only as
  > redirects to equipment surfaces.

  For the full reverse-engineered design see **[`ARCHITECTURE.md`](ARCHITECTURE.md)**; for
  the operating doctrine and frozen-surface contracts see **[`CLAUDE.md`](CLAUDE.md)**.

  ---

  ## Project overview

  | | |
  |---|---|
  | **Frontend** | React 18 · Vite 7 · TypeScript · wouter routing · TanStack Query · Zustand · Tailwind/shadcn · RTL (Hebrew default) · PWA/offline-first (Dexie + service worker) |
  | **Backend** | Express 4 · TypeScript · Drizzle ORM 0.45 · PostgreSQL (`pg`) · Server-Sent Events realtime (+ an additive Socket.io collaboration channel) |
  | **Jobs** | BullMQ 5 + Redis (ioredis) — workers & schedulers; Redis optional in dev, required in prod |
  | **Auth** | Clerk (required in production) or dev-bypass (non-production only — no Clerk secret, or explicit `CLERK_ENABLED=false`) |
  | **Native** | Capacitor 8 (`ios/`, `android/`) wrapping the built web bundle |
  | **Observability** | Sentry (`@sentry/node`, `@sentry/react`) |
  | **Deploy** | Railway (`railway.json`, `Dockerfile`, `nixpacks.toml`) |

  Runtime: Node ≥ 22.12, pnpm 9.15.9.

  ---

  ## Architecture summary

  ```
  Clients (PWA · Capacitor native · display kiosks)
          │  REST + SSE
          ▼
  Express API  (server/index.ts → server/app/routes.ts, ~55 routers)
    middleware: helmet/CSP → cors → compression → clerk → rate-limit
                → i18n → tenantContext → sessionContext
    ├─ routes/      one file per API resource
    ├─ services/    domain logic (equipment, dispense, waitlist, tasks…)
    ├─ domain/      hexagonal evidence-graph + Asset Copilot
    ├─ lib/         authority+enforcement, realtime outbox, audit, metrics…
    ├─ integrations/ external PMS adapters (inbound/outbound, sync, conflicts)
    └─ workers/+jobs/+queues/  BullMQ workers & schedulers
          │                 │                    │
          ▼                 ▼                    ▼
     PostgreSQL         Redis/BullMQ        External PMS
     Drizzle, vt_*      (jobs, push,        (priza, vendor-x,
     tables             integrations)        generic adapters)
  ```

  **Request lifecycle (mutation):** typed client call (`src/lib/api.ts`) → emergency-endpoint
  classifier → Express middleware chain → router → Zod validation → authority/enforcement →
  domain service → `clinicId`-scoped Drizzle write → `vt_event_outbox` row (+ fire-and-forget
  audit) → outbox publisher → SSE broadcast → client cache invalidation.

  Hard rules: **every query filters by `clinicId`**; **role is read from `vt_users.role`, never
  JWT**; the **realtime (SSE+outbox)**, **PWA build-tag cache**, **emergency-endpoint cache
  denylist**, and **authority `off|shadow|enforce` envelope** are frozen contracts.

  ---

  ## Core modules

  | Domain | What it does | Entry points |
  |---|---|---|
  | **Equipment** | Asset CRUD, custody/checkout/return, waitlist + reservation, operational-state lifecycle, RFID/scan location inference, ward/equipment display board, Asset Copilot (evidence-graph explanations) | `routes/equipment*.ts`,
  `routes/rooms.ts`, `routes/returns.ts`, `routes/display.ts`, `services/equipment-*.ts`, `domain/equipment/**` |
  | **Code Blue / safety** | Emergency sessions (online-only, server-confirmed), presence, crash-cart checks, reconciliation scanner | `routes/code-blue.ts`, `routes/crash-cart.ts`, `lib/code-blue-*.ts` |
  - **Phase 9 realtime/PWA:** deterministic counter contracts in `tests/phase-9-deterministic-drills.test.ts`
    + browser harness `tests/phase-9-drills.spec.ts`.
  > "Tasks / משימות". Legacy routes (`/patients`, `/er`, `/billing`, `/meds`) survive only as
  > redirects to equipment surfaces.

  For the full reverse-engineered design see **[`ARCHITECTURE.md`](ARCHITECTURE.md)**; for
  the operating doctrine and frozen-surface contracts see **[`CLAUDE.md`](CLAUDE.md)**.

  ---

  ## Project overview

  | | |
  |---|---|
  | **Frontend** | React 18 · Vite 7 · TypeScript · wouter routing · TanStack Query · Zustand · Tailwind/shadcn · RTL (Hebrew default) · PWA/offline-first (Dexie + service worker) |
  | **Backend** | Express 4 · TypeScript · Drizzle ORM 0.45 · PostgreSQL (`pg`) · Server-Sent Events realtime (+ an additive Socket.io collaboration channel) |
  | **Jobs** | BullMQ 5 + Redis (ioredis) — workers & schedulers; Redis optional in dev, required in prod |
  | **Auth** | Clerk (required in production) or dev-bypass (non-production only — no Clerk secret, or explicit `CLERK_ENABLED=false`) |
  | **Native** | Capacitor 8 (`ios/`, `android/`) wrapping the built web bundle |
  | **Observability** | Sentry (`@sentry/node`, `@sentry/react`) |
  | **Deploy** | Railway (`railway.json`, `Dockerfile`, `nixpacks.toml`) |

  Runtime: Node ≥ 22.12, pnpm 9.15.9.

  ---

  ## Architecture summary

  ```
  Clients (PWA · Capacitor native · display kiosks)
          │  REST + SSE
          ▼
  Express API  (server/index.ts → server/app/routes.ts, ~55 routers)
    middleware: helmet/CSP → cors → compression → clerk → rate-limit
                → i18n → tenantContext → sessionContext
    ├─ routes/      one file per API resource
    ├─ services/    domain logic (equipment, dispense, waitlist, tasks…)
    ├─ domain/      hexagonal evidence-graph + Asset Copilot
    ├─ lib/         authority+enforcement, realtime outbox, audit, metrics…
    ├─ integrations/ external PMS adapters (inbound/outbound, sync, conflicts)
    └─ workers/+jobs/+queues/  BullMQ workers & schedulers
          │                 │                    │
          ▼                 ▼                    ▼
     PostgreSQL         Redis/BullMQ        External PMS
     Drizzle, vt_*      (jobs, push,        (priza, vendor-x,
     tables             integrations)        generic adapters)
  ```

  **Request lifecycle (mutation):** typed client call (`src/lib/api.ts`) → emergency-endpoint
  classifier → Express middleware chain → router → Zod validation → authority/enforcement →
  domain service → `clinicId`-scoped Drizzle write → `vt_event_outbox` row (+ fire-and-forget
  audit) → outbox publisher → SSE broadcast → client cache invalidation.

  Hard rules: **every query filters by `clinicId`**; **role is read from `vt_users.role`, never
  JWT**; the **realtime (SSE+outbox)**, **PWA build-tag cache**, **emergency-endpoint cache
  denylist**, and **authority `off|shadow|enforce` envelope** are frozen contracts.

  ---

  ## Core modules

  | Domain | What it does | Entry points |
  |---|---|---|
  | **Equipment** | Asset CRUD, custody/checkout/return, waitlist + reservation, operational-state lifecycle, RFID/scan location inference, ward/equipment display board, Asset Copilot (evidence-graph explanations) | `routes/equipment*.ts`,
  `routes/rooms.ts`, `routes/returns.ts`, `routes/display.ts`, `services/equipment-*.ts`, `domain/equipment/**` |
  | **Code Blue / safety** | Emergency sessions (online-only, server-confirmed), presence, crash-cart checks, reconciliation scanner | `routes/code-blue.ts`, `routes/crash-cart.ts`, `lib/code-blue-*.ts` |
  | **Authority & enforcement** | Effective clinical authority + per-clinic evaluator families (`off \| shadow \| enforce`) with Strategy-A safety net | `lib/authority.ts`, `lib/authority/enforcement/*`, `middleware/authority.ts` |
  | **Inventory / dispense** | Containers, items, dispense (idempotent), restock, procurement/POs, shadow-inventory reconciliation | `routes/{containers,dispense,restock,inventory-items,procurement}.ts`, `services/*.ts` |
  | **Tasks & shifts** | Unified task model, task intelligence/automation/recall, shifts, clinical check-in, shift chat, alerts | `routes/{tasks,appointments,shifts,clinical-check-in,shift-chat,alert-acks}.ts` |
  | **Integrations** | External PMS adapters, HMAC inbound webhooks, canonical mapping, conflict engine, rollout/resilience, health dashboard | `server/integrations/**`, `routes/integrations.ts` |
  | **Realtime** | SSE stream, outbox publisher, replay, keepalive, DLQ/janitor health; plus an additive, isolated Socket.io collaboration channel (`/collab-ws`) for presence/typing/cursors — ephemeral only, never domain state | 
  `routes/realtime.ts`, `lib/event-publisher.ts`, `lib/outbox-*.ts`, `lib/realtime-collab/*`, `src/lib/collab-socket.ts` |
  | **Platform/infra** | Auth mode, tenant context, i18n, rate limiting, audit, metrics, config crypto, push, uploads | `server/middleware/*`, `server/lib/*`, `routes/{users,push,uploads,support}.ts` |
  | **Frontend shell** | Provider stack, lazy route table, platform split (native vs web), offline sync, SW lifecycle | `src/main.tsx`, `src/app/routes.tsx`, `src/{native,desktop,shell}/*`, `src/lib/*` |
  
  ---

  ## Execution flow

  **Server startup** (`server/index.ts`):
  `env-bootstrap` (loads `.env.local` then `.env`; OS env always wins) → Sentry init → `validateEnv()` → build
  Express app → health routes (bypass middleware) → security/CORS/compression → raw-body
  webhook mounts (Clerk svix, integration HMAC, RFID) → `express.json()` + global XSS
  sanitizer → conditional Clerk middleware → `/api` rate-limit → i18n → tenant → session →
  `registerApiRoutes()` → (prod) SPA static serving → `app.listen(PORT)` →
  `runMigrations()` → `ensureClinicPhase2Defaults()` → `startBackgroundSchedulers()`. After
  `app.listen`, the additive Socket.io collaboration channel is initialized on the shared HTTP
  server via a non-fatal dynamic import (R-RTC-1) — any failure logs and leaves the channel
  disabled while SSE, `vt_event_outbox`, and Code Blue start normally.

  **Frontend startup** (`src/main.tsx`): React root → provider stack (QueryClient, Settings,
  Confirm, Clerk auth, error boundary, Sync) → register build-tag-versioned service worker (web)
  or construct native Clerk instance (Capacitor) → `App` → wouter route table (`src/app/routes.tsx`).

  **Background work** (`server/app/start-schedulers.ts`, skipped in tests): outbox publisher,
  outbox janitor + DLQ scanner, job runtime (expiry/charge-alert/stale-checkin), integration
  worker + crons, task-ownership backfill/sweep, shadow inventory, Code Blue reconciliation,
  five equipment operational-state workers, emergency-dispense scanner, and push/health/watchdog
  schedulers.

  ---

  ## Installation

  ```bash
  # Prerequisites: Node >= 22.12 (nvm use), pnpm 9.15.9, PostgreSQL, Redis (optional in dev)
  pnpm install
  cp .env.example .env          # fill DATABASE_URL etc.
  pnpm db:migrate               # apply all migrations (also runs at server startup)
  pnpm dev                      # API :3001 + Vite :5000 (predev frees the ports)
  ```

  **Minimal dev `.env`** (omit Clerk keys to use dev-bypass auth — hardcoded admin, no Clerk SDK):

  ```env
  DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
  SESSION_SECRET=dev-session-secret-for-local-development
  NODE_ENV=development
  ```

  ---

  ## Configuration

  - **Env precedence** (highest → lowest): OS env (`process.env`) → `.env.local` → `.env`. `dotenv` never overwrites an already-set variable, so OS/Railway/CI values win (`server/lib/env-bootstrap.ts`). Full reference: `.env.example`.
  - **Auth mode** (resolved at startup by `server/lib/auth-mode.ts`):
    - *dev-bypass* — **non-production `NODE_ENV` only**, when no `CLERK_SECRET_KEY` is set (or `CLERK_ENABLED=false` is the explicit override) → hardcoded `DEV_USER` (admin, `clinicId = dev-clinic-default`). In production this path is
  gated off (`server/middleware/auth.ts`) and `validateEnv()` requires Clerk, so omitting keys does not silently enable the bypass.
    - *clerk* — `CLERK_SECRET_KEY` present (and `CLERK_ENABLED !== "false"`) → full Clerk JWT validation
  - **Role hierarchy** (numeric): `admin=40 · vet=30 · senior_technician=25 · lead_technician=22 · vet_tech=20 · technician=20 · student=10`. Always sourced from `vt_users.role`.
  - **Required production env vars** (enforced at startup by `server/lib/envValidation.ts`):
    `DATABASE_URL` (or `POSTGRES_URL`), `REDIS_URL`, `SESSION_SECRET`, `CLERK_SECRET_KEY`,
    `VITE_CLERK_PUBLISHABLE_KEY`, `ALLOWED_ORIGIN`, `CLERK_WEBHOOK_SECRET`,
    `DB_CONFIG_ENCRYPTION_KEY` (AES-256-GCM for integration creds in `vt_server_config`),
    `DATA_INTEGRITY_HEALTH_TOKEN`, `DB_SSL_REJECT_UNAUTHORIZED`, `S3_ACCESS_KEY_ID`,
    `S3_SECRET_ACCESS_KEY`.
  - **Feature/rollout flags** via `server/lib/feature-flags.ts` and `integrations/feature-flags.ts`.
  - **Collaboration channel flags** (`server/lib/realtime-collab/config.ts`, all optional — the channel is safe-by-default): `COLLAB_WS_ENABLED` (default on; set `false` to kill the channel), `COLLAB_WS_ALLOW_SINGLE_INSTANCE` (permit the
  bounded in-process presence fallback when Redis is absent — production otherwise requires the Redis adapter for cross-instance fan-out), `COLLAB_WS_ALLOWED_ORIGINS` / `APP_ORIGINS` (handshake Origin allowlist for the CSWSH defense).

  ---

  ## Development workflow

  1. **Schema change** → edit `server/schema/*.ts` → `npx drizzle-kit generate` → commit SQL → `pnpm db:migrate`.
  2. **New API route** → add `server/routes/<x>.ts` → register in `server/app/routes.ts`.
  3. **New worker/scheduler** → register in `server/app/start-schedulers.ts`.
  4. **API surface** → typed function in `src/lib/api.ts` + type in `src/types/`.
  5. **New page** → `src/pages/` + lazy `<Route>` in `src/app/routes.tsx`.
  6. **User copy** → keys in `locales/he.json` + `locales/en.json` (parity enforced); access via typed `t`.
  7. **New audit kind** → extend the closed `AuditActionType` union in `server/lib/audit.ts`.
  8. **New telemetry** → bounded enum on client + `server/routes/realtime.ts` + closed union in `server/lib/metrics.ts`.
  9. **Always** run `pnpm typecheck` (zero errors). Realtime/Code Blue/PWA changes need browser verification (Playwright drills).

  Architecture gates: `pnpm architecture:gates` (dependency-cruiser, madge cycles, tenant-query
  lint, route contract, query-key audit), `pnpm knip` (dead code), `pnpm i18n:check` (locale parity).

  ---

  ## Build / run commands

  | Command | Description |
  |---|---|
  | `pnpm dev` | API (:3001) + Vite (:5000) concurrently |
  | `pnpm build` | Production frontend build → `dist/public` |
  | `pnpm start` | Production server (`NODE_ENV=production`) |
  | `pnpm worker` | Standalone notification worker CLI (Redis required) |
  | `pnpm typecheck` | `tsc --noEmit` for app + server configs |
  | `pnpm test` | Vitest unit/integration suite |
  | `pnpm db:migrate` | Apply pending migrations |
  | `pnpm validate:prod` | Pre-deployment checks |
  | `pnpm auth:preflight` | Verify Clerk config + auth mode |
  | `pnpm docs:audit` | Regenerate `docs/audit/*` route & schema inventories |
  | `pnpm cap:build:native` / `:android` | Build bundled Capacitor shell |
  | `pnpm cap:install:ios-sim` | Build + install on iOS Simulator (macOS + Xcode only) |

  ---

  ## Testing approach

  - **Vitest** (`pnpm test`) — unit + integration. Several groups are excluded by default in
    `vite.config.ts`: DB-integration tests (need `DATABASE_URL` + migrations), live-server tests
    (need a running `:3001`), and the Phase 9 Playwright browser drills.
  - **DB / ops integration:** `pnpm test:db-integration`, `pnpm test:integration:ops`.
  - **Playwright E2E:** `pnpm test:playwright:*` (waitlist, pwa, phase9, signup, workday, ui-smoke).
    Chromium is pre-provisioned in the cloud environment — do not run `playwright install`.
  - **Phase 9 realtime/PWA:** deterministic counter contracts in `tests/phase-9-deterministic-drills.test.ts`
    + browser harness `tests/phase-9-drills.spec.ts`.
  - **Staging:** `pnpm test:staging:e2e`, `pnpm staging:seed`.

  Coverage target is 80%+ (see `.claude/rules/ecc/common/testing.md`); prefer the AAA pattern.

  ---

  ## External integrations

  - **Clerk** — auth + user webhooks (`/api/webhooks/clerk`, svix-verified raw body).
  - **PMS adapters** — `priza`, `vendor-x`, `generic-pms`, `local-sandbox` over a common `base`
    (`server/integrations/adapters/*`). Inbound webhooks are HMAC-verified over raw body with a
    CIDR allowlist (`/api/integration-webhooks/:adapterId`); outbound sync + conflict resolution
    via canonical mappers and a conflict engine. Circuit breaker, rate limits, and staged rollout
    policy live in `server/integrations/resilience/*` and `rollout/*`.
  - **Redis / BullMQ** — job runtime, push fan-out, integration sync.
  - **AWS S3** — uploads/storage (`@aws-sdk/client-s3`, multer).
  - **Web Push (VAPID)** — push notifications.
  - **Anthropic** — Asset Copilot explanations (`server/lib/anthropic-client.ts`).
  - **Sentry** — error/perf monitoring on client and server.

  ---

  ## Repository structure

  ```
  src/                 React frontend (PWA, RTL, offline-first)
    app/               wouter route table + platform guards
    pages/             route-level page components (all lazy-loaded)
    features/          feature modules (auth, equipment, inventory, shift-chat, …)
    components/        shared UI (shadcn/Radix primitives in components/ui/)
    native/ desktop/   Capacitor native shell vs web shell (selected by PlatformRouter)
    shell/             legacy re-export aliases over native/ + desktop/
    core/ infrastructure/  emerging hexagonal layer (entities/use-cases/ports + adapters)
    hooks/  lib/       auth/push/settings/offline hooks · api client, offline-db, sync-engine, realtime, collab-socket, i18n
  server/
    index.ts           Express entry (env-bootstrap first)
    app/               routes.ts (route registration) + start-schedulers.ts
    routes/            one file per API resource (~55)
    schema/            Drizzle pgTable definitions (barrel index.ts, re-exported via db.ts)
    services/          domain services
    domain/            hexagonal equipment evidence-graph + Asset Copilot
    lib/               business logic: authority/enforcement, realtime outbox, realtime-collab (Socket.io), audit, metrics, push…
    integrations/      external PMS adapter layer
    jobs/ queues/ workers/  BullMQ runtime, queue defs, worker implementations
    middleware/        auth, tenant-context, rate-limiters, authority, validate, idempotency
  lib/                 i18n utilities shared by frontend + backend
  locales/             en.json, he.json (Hebrew default; parity enforced)
  shared/              constants + types shared across front/back
  migrations/          170+ SQL files (numbered through 171), applied in order at startup
  scripts/             dev/ops + architecture-gate scripts
  public/sw.js         service worker (build-tag cache, emergency endpoint denylist)
  ios/ android/        Capacitor native projects
  docs/                architecture, runbooks, integrations, audit inventories
  ```

  ---

  ## Known architectural patterns

  - **Multi-tenant by `clinicId`** on every table and every query.
  - **Outbox-backed SSE realtime** — monotonic cursor ordering, HTTP replay, keepalive. The
    domain/emergency event path is SSE-only (never WebSockets/polling) and stays a frozen
    contract; emergency endpoints are never cached.
  - **Additive Socket.io collaboration channel** (R-RTC-1) — a separate, isolated transport on
    `/collab-ws` carrying only ephemeral presence/typing/cursor signals. It never carries domain
    or emergency state, does not replace the SSE path, and its startup is non-fatal (SSE, outbox,
    and Code Blue run normally if it fails to initialize).
  - **Offline-first sync engine** — Dexie cache + FIFO queue + circuit breaker; emergency
    mutations are intercepted and fail loud (never queued).
  - **Authority `off | shadow | enforce` evaluators** per clinic, with a preserved Strategy-A
    shift-derived fallback and fail-open carve-out.
  - **Closed unions** for audit kinds and telemetry counters (extend the union, never free-form).
  - **Container/presentational + server-state separation** on the frontend (TanStack Query for
    server state, Zustand/URL for client state).
  - **Platform split** via `resolvePlatformTarget()`/`usePlatformTarget()` (`mobile | desktop | marketing`) →
    `PlatformRouter` wraps mobile in `NativeShell`, desktop/marketing pass through to per-page web chrome (`src/app/platform`).
  - **Emerging hexagonal core** (`src/core` + `src/infrastructure`, `server/domain`) layered over
    the older service/lib style — migration is partial.
  - **Architecture enforced in CI** — dependency-cruiser, madge cycle checks, tenant-query lint,
    route-contract extraction, knip dead-code, i18n parity.

  ---

  ## Documentation

  - [`ARCHITECTURE.md`](ARCHITECTURE.md) — full module/dependency/flow reference
  - [`CLAUDE.md`](CLAUDE.md) — operating doctrine & frozen-surface contracts
  - [`docs/README.md`](docs/README.md) — documentation index
  - [`docs/scope-change-2026.md`](docs/scope-change-2026.md) — removed domains
  - [`docs/architecture/`](docs/architecture/) — ADRs, domain boundaries, offline/realtime invariants
  - [`docs/audit/db.md`](docs/audit/db.md) — generated schema inventory
  - [`docs/integrations-guide.md`](docs/integrations-guide.md), [`docs/migrations.md`](docs/migrations.md), [`docs/testing-guide.md`](docs/testing-guide.md), [`docs/mobile/README.md`](docs/mobile/README.md)

