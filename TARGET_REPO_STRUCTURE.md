# TARGET_REPO_STRUCTURE.md

> **Phase 2 — Design the rebased repository.**
> Optimizes for: ownership · security boundaries · runtime boundaries · domain isolation · minimal
> cognitive load · auditability. Canonical input: the audit's `TARGET_ARCHITECTURE.md §3-§7`.
>
> **Reconciliation note.** The brief's generic skeleton (`apps/ domains/{auth,tenancy,workflows,
> investigations,reporting} security/ workers/ infrastructure/ shared/`) is a *template*. VetTrack has
> no `investigations`/`reporting` products, and its security/auth is a request-pipeline concern, not a
> standalone deployable. So the target below **keeps the brief's top-level buckets where they map to
> reality** and is **anchored to the audit's six canonical domains**, which is also what
> `MIGRATION_PLAN.md` migrates toward. Where the template and reality diverge, reality (the audit) wins —
> per the mission: *"make the repository structure accurately represent the architecture that already exists."*

---

## 0. Target tree (top level)

```
repo/
├── apps/                  # deployable entry points (thin; compose domains)
│   ├── api/               # Express server process  (server/index.ts)
│   ├── worker/            # BullMQ worker process    (start-schedulers.ts)
│   └── client/            # Vite web/PWA/Capacitor bundle entry (main.tsx, App, index.html)
│
├── domains/              # the six canonical domains (the heart of the rebase)
│   ├── shared/           # framework-free kernel — imports NOTHING
│   ├── native/           # touch presentation (Capacitor + mobile-web)
│   ├── desktop/          # web/pointer presentation + marketing
│   ├── offline/          # offline-first, sync, PWA, realtime client
│   ├── backend/          # Express API (routes, services, data, integrations)
│   │   └── security/     # authn · authz · policies · audit  (boundary subtree)
│   └── workers/          # background processing (separate process)
│
├── infrastructure/      # cross-domain platform substrate
│   ├── database/         # Drizzle pool + schema + migrations
│   ├── queues/           # BullMQ + Redis wiring
│   ├── storage/          # uploads / object storage
│   ├── messaging/        # push · whatsapp · realtime SSE transport (FROZEN)
│   └── integrations/     # external PMS adapter layer
│
├── tooling/             # scripts, CI, boundary enforcement, build/deploy config
├── tests/               # all vitest + Playwright suites
└── docs/                # architecture, ADRs, audits, runbooks + this rebase's deliverables
```

> **Pragmatic placement of `database/queues/integrations`:** physically these live *under* `domains/backend`
> and `domains/workers` in the migrated tree (they are server-process code). `infrastructure/` is the
> **logical** grouping used for dependency rules and ownership; `REPO_MOVE_PLAN.md` keeps them inside the
> server tree to avoid breaking Drizzle/relative imports, and the lint treats them as the `infrastructure`
> boundary. The audit's six-domain graph (`TARGET_ARCHITECTURE.md §7`) is the authority on imports.

---

## 1. `domains/shared/` — the kernel (Expo seam)

- **Owner:** kernel maintainers (cross-domain). CODEOWNERS: `@exposwifty31`.
- **Responsibilities:** entities, use-cases (pure rules), **ports** (platform contract interfaces),
  the **route table / nav-model** (SSoT), API contract types, permissions, i18n keys + locales.
- **Consolidates today:** `src/core/`, `src/lib/routes/`, top-level `shared/*.ts`, `src/types/`,
  `lib/i18n`, `shared/contracts/`.
```
domains/shared/
  entities/      design-tokens, equipment-truth, authority types, permissions, equipment-readiness-rules
  use-cases/     offline-emergency-block, handoff-debt, equipment-board (pure)
  ports/         NfcPort · HapticsPort · DeepLinkPort · StatusBarPort · KeyboardPort
                 CachePort · SyncQueuePort · ApiClientPort · AuthSessionPort
  routes/        nav-model.ts (THE route table) + resolve-nav-active, canonical-hrefs
  contracts/     API request/response types + versioned vendor contracts
  i18n/          typed keys + he.json/en.json (parity-enforced)
```
- **Allowed imports:** TypeScript std + other `shared/` only.
- **Forbidden imports:** `react`, `react-dom`, `@ionic/*`, `@capacitor/*`, `express`, `drizzle-orm`,
  `wouter`, `dexie`, anything in `native|desktop|offline|backend|workers`.
- **Security assumptions:** carries auth **types** (roles, permissions, type-enforced student ceiling)
  but **never** secrets, the resolver, or a session reader. No I/O. No tenant data.

---

## 2. `domains/native/` — touch presentation

- **Owner:** mobile/client. **Responsibilities:** the single shell that owns ALL native chrome
  (safe areas, scroll, header, tab bar, keyboard, status bar, nav stack), native screens (pure content),
  Capacitor adapters implementing `shared/ports`.
- **Consolidates today:** `src/native/`, `src/shell/mobile/` (retire `MobileShell`),
  touch screens in `src/features/{today,equipment,alerts,scan,settings,shift-chat,containers}`,
  `src/infrastructure/platform/*Adapter`.
```
domains/native/
  shell/     NativeShell · StatusBar · NativeHeader · NativeScreen · NativeTabBar
  router/    MobileRouter (native-aware outlet; NOT IonRouterOutlet; Expo-portable)
  screens/   TodayScreen, EquipmentListScreen, EquipmentDetailScreen, AlertsScreen, ScanScreen, …
  platform/  NfcAdapter · HapticsAdapter · DeepLinkAdapter · StatusBarAdapter · KeyboardAdapter
```
- **Allowed imports:** `shared/`, `offline/`.
- **Forbidden imports:** `desktop/`, `backend/`, `workers/`, another shell. Screens must **not** read
  `env(safe-area-inset-*)`, `100dvh`, `matchMedia`, document scroll, or draw a tab bar (lint target).
- **Security assumptions:** no secrets; auth via `AuthSessionPort`. **Expo disposition:** the one large
  throwaway (DOM → RN).

---

## 3. `domains/desktop/` — web/pointer presentation + marketing

- **Owner:** web/client. **Responsibilities:** desktop shell (Topbar + Sidebar + Container, sole desktop
  scroll/inset owner), desktop pages, the public chrome-free `MarketingShell`, `DesktopRouter`.
- **Consolidates today:** `src/desktop/`, `src/pages/`, `src/components/`, `src/shell/desktop/`,
  `src/app/routes.tsx` (→ DesktopRouter); collapses `AppShell` (→ WebShell) and retires `Layout`.
```
domains/desktop/
  shell/      WebShell · Sidebar · Container · Topbar
  router/     DesktopRouter (wouter <Switch> over shared route table)
  pages/      desktop page implementations (pure content)
  components/ shared UI (shadcn primitives)
  marketing/  MarketingShell (landing · privacy · terms)
```
- **Allowed imports:** `shared/`, `offline/`.
- **Forbidden imports:** `native/`, `backend/`, `workers/`, another shell. No mobile chrome; no own nav table.
- **Security assumptions:** no secrets; auth via `AuthSessionPort`. **Expo disposition:** stays web.

---

## 4. `domains/offline/` — offline-first · sync · PWA · realtime client

- **Owner:** offline/platform. **Responsibilities:** Dexie store, sync-engine (queue/retry/circuit-breaker/
  conflict store), the FROZEN offline-emergency-block, SSE client reconciliation, the service worker,
  storage adapters implementing `shared/ports`.
- **Consolidates today:** `src/lib/{offline-db,sync-engine,offline-emergency-block}.ts`, realtime client
  reconciliation in `src/lib`, `src/infrastructure/db/*Adapter`, `public/sw.js`.
```
domains/offline/
  db/          Dexie schema (equipment/rooms cache, pending-sync queue, conflict store)
  sync-engine/ FIFO queue, retry, circuit-breaker, 409→conflict store, bounded result taxonomy
  emergency/   offline-emergency-block classifier   FROZEN (Code Blue never queued)
  realtime/    SSE client reconciliation (replay + snapshot)   FROZEN transport
  pwa/         service worker (build-tag cache, emergency denylist)   FROZEN
  adapters/    CacheAdapter, SyncQueueAdapter (Dexie today; SQLite/MMKV at Expo)
```
- **Allowed imports:** `shared/`.
- **Forbidden imports:** `native/`, `desktop/`, `backend/`, `workers/`.
- **Security assumptions:** emergency mutations **never queued**; SW emergency denylist unconditional;
  build-tag is SW cache SSoT. **Expo disposition:** keep contracts, swap storage adapter.

---

## 5. `domains/backend/` — Express API (preserve & harden)

- **Owner:** backend. **Responsibilities:** routes, services, server-side domain logic, schema/data,
  request middleware, integrations, realtime SSE endpoints. **Preserve every Strong property; add only
  the audited backstops.**
- **Consolidates today:** all of `server/` except the worker/queue/scheduler subtree (→ `workers/`) and
  the kernel files re-homed to `shared/`.
```
domains/backend/
  http/
    routes/       ~48 resource routers (+ routes/equipment/ handlers, routes/domains/ for new code)
    middleware/   validate, rate-limiters, idempotency, *-idempotency
  security/       ← explicit boundary subtree (see §6)
  services/       dispense, procurement, equipment-*, restock, inventory, code-blue, appointments, …
  domain/         equipment evidence/copilot server-side logic
  data/           schema/ (vt_* tables), db.ts (pool), migrate.ts, seed.ts   → infrastructure/database
  realtime/       SSE stream/replay/outbox endpoints   FROZEN
  integrations/   PMS webhook inbound/outbound (svix + constant-time HMAC)   → infrastructure/integrations
```
- **Allowed imports:** `shared/`. (Plus infrastructure substrate it owns.)
- **Forbidden imports:** `src/*` client code (already enforced: `no-frontend-to-server` /
  `no-server-to-frontend`), `native/`, `desktop/`, `offline/`, `workers/` runtime.
- **Security assumptions (preserve, do not regress):** A1–A4, B1–B4, C2–C4, D1–D2. Role DB-authoritative;
  client never sends trusted `clinicId`; every `vt_` query filters `clinicId`. **Added backstops:**
  RLS (C1/I1), D3 explicit predicates, `clinicId` co-presence lint.

---

## 6. `domains/backend/security/` — authn · authz · policies · audit (boundary subtree)

- **Owner:** security (CODEOWNERS-protected). **Responsibilities:** the auth/authority request pipeline.
  This is the brief's `security/{authn,authz,policies,audit}` — realized **inside** backend because it is
  middleware on the live request path, not a separate deployable.
```
domains/backend/security/
  authn/      auth.ts (middleware), clerk-session-auth, clerk-*, auth-mode, admin-email-allowlist,
              stability-token, stability-log, apple-auth
  authz/      authority.ts (resolveAuthority — the ONE resolver), authority middleware, role-resolution,
              authority-cache, authority-roles, access-denied, er-mode-permissions, task-rbac
  policies/   authority/enforcement/* (off|shadow|enforce evaluator families + Strategy-A safety net)
  audit/      audit.ts (closed AuditActionType union), authority-audit, config-crypto
  tenancy/    tenant-context, ensure-user-clinic-membership  (+ RLS backstop added in Phase 6)
```
- **Allowed imports:** `shared/` (auth types), `backend/data` (DB reads).
- **Forbidden imports:** `apps/*` entry composition (security is imported, not the importer of apps),
  any client domain. Role must **never** be read from JWT; `clinicId` must **never** be trusted from client.
- **Security assumptions:** single identity truth; enforcement envelope intact; Strategy-A never retired.

---

## 7. `domains/workers/` — background processing (separate process)

- **Owner:** workers/platform. **Responsibilities:** BullMQ workers + schedulers, job runtime/registry/
  enqueue, the realtime **outbox publisher** (FROZEN), DLQ + reconciliation scanners.
- **Consolidates today:** `server/workers/`, `server/jobs/`, `server/queues/`,
  `server/app/start-schedulers.ts`, outbox/scheduler/idempotency libs in `server/lib`.
```
domains/workers/
  orchestration/  start-schedulers.ts (single registration point), runtime, registry, enqueue, queue-factory
  executors/      chargeAlert, expiryCheck, integration, notification, staleCheckInSweep,
                  staleCheckoutSweep, staleTaskOwnershipSweep, taskOwnershipBackfill, stagingExpiry, …
  scheduling/     job definitions (crons, delayed jobs, TTL sweeps), integration schedules/retention
  outbox/         event-publisher (FOR UPDATE SKIP LOCKED) FROZEN, janitor, dlq-scanner,
                  error-classification, health, code-blue-reconciliation-scanner
```
- **Allowed imports:** `shared/`, `backend/` (schema, services).
- **Forbidden imports:** any client domain (`native/`, `desktop/`, `offline/`), UI.
- **Security assumptions:** idempotency = Redis cache + DB uniqueness; status-idempotent confirm
  (no double-deduct); Strategy-A never retired. **Workers run WITHOUT a user** — must carry an explicit
  `app.current_clinic_id`/bypass role before RLS flips to enforce (Phase 6, R-T). **Added:** pilot-queue
  DLQ + alarm; 64-bit advisory locks.

---

## 8. `infrastructure/` — platform substrate

- **Owner:** platform. **Responsibilities:** the substrate the server domains stand on. Physically inside
  the server tree (Drizzle/Redis imports), logically grouped for boundary rules.
```
infrastructure/
  database/      Drizzle pool, vt_* schema, migrations (163), seed   [migrations CODEOWNERS-protected]
  queues/        BullMQ + Redis wiring (queue.ts, redis.ts, queue-factory)
  storage/       uploads, object storage routes/helpers
  messaging/     push fan-out, whatsapp, realtime SSE transport (FROZEN)
  integrations/  PMS adapters, webhooks (svix + HMAC), conflicts, dashboard, rollout, resilience
```
- **Allowed imports:** `shared/`. Consumed by `backend/` + `workers/`.
- **Forbidden imports:** client domains. **Security assumptions:** integration credentials encrypted
  (AES-256-GCM) when `DB_CONFIG_ENCRYPTION_KEY` set; webhook signatures verified (constant-time HMAC).

---

## 9. `apps/`, `tooling/`, `tests/`, `docs/`

| Dir | Owner | Responsibilities | Allowed imports | Forbidden | Security |
|---|---|---|---|---|---|
| `apps/api` | backend | Express bootstrap (`server/index.ts`), env-bootstrap FIRST | `backend/`, `infrastructure/`, `shared/` | client domains | loads secrets via env only |
| `apps/worker` | workers | worker-process entry (`start-schedulers.ts`) | `workers/`, `backend/`, `infrastructure/`, `shared/` | client domains | runs without user (see §7) |
| `apps/client` | desktop/native | `main.tsx`, `App`, `index.html`, PlatformRouter mount, SW registration (FROZEN) | all client domains + `shared/` | `backend/`, `workers/` | no secrets in bundle |
| `tooling/` | platform | scripts, CI, `.dependency-cruiser.cjs`, CODEOWNERS, build/deploy config | n/a | — | secrets scan (`scripts/scan-secrets.ts`) stays |
| `tests/` | all | vitest + Playwright; keep frozen-surface drills + regression locks green | test targets | — | preserve `cross-tenant-denial`, `authority-*`, `mobile-shell` |
| `docs/` | all | architecture, ADRs, audits, runbooks + the six rebase deliverables | n/a | — | — |

---

## 10. Dependency graph (target — acyclic)

```
                         ┌──────────────┐
                         │   shared/    │   pure TS · imports NOTHING · the kernel/SSoT
                         └──────▲───────┘
        ┌───────────────┬───────┼─────────┬────────────────┐
   ┌────┴────┐    ┌─────┴───┐   │    ┌────┴─────┐    ┌──────┴─────┐
   │ native/ │    │desktop/ │   │    │ offline/ │    │  backend/  │ (incl. security/, infrastructure/)
   └────┬────┘    └────┬────┘   │    └────▲─────┘    └──────▲─────┘
        └──────────────┴────────┼─────────┘          ┌──────┴─────┐
        client shells → shared/ + offline/           │  workers/  │ → shared/ + backend/
                                                      └────────────┘
```
- Acyclic; `shared/` is the universal sink; no domain depends on a presentation domain;
  **no shell imports another shell.**
- **Expo swap surface:** only `native/` (DOM→RN) + `offline/` adapters change; everything else invariant.

Full rule set: `DEPENDENCY_RULES.md`. Move plan: `REPO_MOVE_PLAN.md`. Order: `MIGRATION_SEQUENCE.md`.
