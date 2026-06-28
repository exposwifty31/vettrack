# ARCHITECTURE_MAP.md

> **Phase 0 — Ground truth.**
> Canonical source: `VetTrack — Forensic Security & Architecture Verification Audit`
> (bundles: *Security Report* · `NATIVE_ARCHITECTURE.md` · `TARGET_ARCHITECTURE.md` · `MIGRATION_PLAN.md`).
> This document extracts the architecture **as it already exists**, with every boundary
> anchored to a real `file:line` and an audit finding (`Ax`/`Bx`/`Cx`/`Dx`/`Ex`/`Fx`/`F-n`/`In`).
> It does **not** redesign anything. It is the map the rest of the rebase is measured against.

---

## 0. One-paragraph orientation

VetTrack is a **veterinary hospital operations platform** that ships as **one Vite bundle**
serving **three live client targets** (marketing web · installed PWA · Capacitor native) on top of a
**single Express + PostgreSQL backend** and a **separate BullMQ worker process**. The security audit
rates the server **Strong** across auth, authorization, database, webhooks, and tests, with two
named architectural caveats (app-only tenant isolation; pilot-queue DLQ gap). The native audit finds
the **client** is a web-first PWA wrapped in Capacitor with cross-cutting native concerns owned "by
committee" (2–7 owners each). The canonical target therefore has an **asymmetric mandate**:
**preserve & harden** the backend/workers/tenancy/auth; **re-architect** the client shells around
**one owner per concern, one shell per target, one shared kernel**.

---

## 1. System domains (the six canonical domains)

Per `TARGET_ARCHITECTURE.md §3`, the system decomposes into six dependency-bounded domains. These are
the canonical domains of the rebase (they supersede the generic `investigations/reporting` template
names in the brief — those products do not exist in this codebase).

```
shared/            framework-free kernel — the Expo seam, imports NOTHING
  ├── entities         design tokens, equipment-truth, authority types, permissions
  ├── use-cases        offline-emergency-block, equipment-readiness-rules, handoff-debt
  ├── ports            platform contract interfaces (Nfc/Haptics/DeepLink/StatusBar/Keyboard/Cache/SyncQueue/Api/AuthSession)
  ├── routes           nav-model (THE route table) + active-state resolution
  ├── contracts        API request/response types
  └── i18n             typed keys + locales (he default, en) — parity-enforced

native/            touch presentation (Capacitor + mobile-web) — replace-at-Expo leaf
  ├── shell            NativeShell + StatusBar/NativeHeader/NativeScreen/NativeTabBar
  ├── router           MobileRouter (native-aware outlet; NOT IonRouterOutlet)
  ├── screens          pure content (chrome-agnostic)
  └── platform         Capacitor adapters implementing shared/ports

desktop/           web/pointer presentation — stays web
  ├── shell            WebShell (Topbar + Sidebar + Container)
  ├── router           DesktopRouter (wouter <Switch> over shared route table)
  ├── pages            desktop page implementations
  └── marketing        MarketingShell (public, chrome-free)

offline/           offline-first + sync + PWA — keep contracts, swap adapters at Expo
  ├── db               Dexie store (equipment/rooms cache, pending-sync queue, conflict store)
  ├── sync-engine      FIFO queue, retry, circuit-breaker, 409→conflict store
  ├── emergency        offline-emergency-block classifier (FROZEN)
  ├── realtime         SSE client reconciliation (replay + snapshot, FROZEN)
  ├── pwa              service worker (build-tag cache, emergency denylist, FROZEN)
  └── adapters         Cache/SyncQueue adapters implementing shared/ports

backend/           Express API — preserve 100% + add backstops
  ├── http             routes (~48 modules) + middleware (auth, authority, tenant-context, …)
  ├── services         domain services (dispense, procurement, equipment, code-blue, …)
  ├── domain           server-side domain logic (equipment evidence/copilot)
  ├── data             schema (vt_* tables), db pool, migrate, seed
  ├── realtime         SSE stream/replay/outbox endpoints (FROZEN)
  └── integrations     PMS webhook inbound/outbound (svix + constant-time HMAC)

workers/           background processing (separate process) — preserve 100% + close 2 gaps
  ├── registry         start-schedulers (single registration point), job definitions, registry, enqueue
  ├── workers          chargeAlert, expiryCheck, integration, staleCheckInSweep, … (13 workers)
  └── outbox           event-publisher (FOR UPDATE SKIP LOCKED), janitor, DLQ scanner, reconciliation scanner
```

**Process boundaries**
- `backend/` runs in the API process (`server/index.ts` → `pnpm dev` / `pnpm start`).
- `workers/` runs in a separate process (`pnpm worker`) with its own lifecycle/scaling.
- `native/` · `desktop/` · `offline/` · `shared/` compile into the client bundle (`dist/public`).
- `shared/` also compiles into the server (kernel is the only code crossing the client/server line).

---

## 2. Security boundaries

> Source: Security Report §1.1–1.8, §4. Server rating: **Strong** (auth/authz/db/webhooks/tests),
> **Good** (workers/state), **Good-but-app-only** (tenant isolation).

```
Security (cross-cutting — physically realized inside backend/)
├── authn  (authentication)
│   ├── identity source     Clerk session → DB user row; SINGLE source of truth        [A1] server/lib/clerk-session-auth.ts:14-24
│   ├── role authority      ALWAYS read from vt_users.role, never JWT claims            [A1] server/middleware/auth.ts:484, 414-421
│   ├── prod hardening      cannot start in dev-bypass; dev overrides gated             [A2] server/middleware/auth.ts:138-140, 255
│   └── gated bypasses      stability-token (loopback-only) · ADMIN_EMAILS (first-login only) [A3/A4] server/lib/stability-token.ts · admin-email-allowlist.ts
├── authz  (authorization)
│   ├── legacy/system stack requireAuth/requireAdmin/requireEffectiveRole + ROLE_HIERARCHY [B1] server/middleware/auth.ts:43-52, 671-791
│   ├── clinical authority  ONE resolver resolveAuthority()                              [B1] server/lib/authority.ts:127-370
│   │   └── middleware      requireClinicalAuthority (does not re-implement shift logic) [B1] server/middleware/authority.ts:98-239
│   ├── admin-bypass        explicit, differs per stack (allowSystemAdmin flag)         [B2] server/middleware/authority.ts:170-173
│   └── student ceiling     type-enforced; never elevates                              [B3] shared/authority.ts:33-43 · authority.ts:137-147
├── policies (enforcement envelope)
│   ├── off | shadow | enforce  per-clinic, short TTL                                   [B4] server/lib/authority/enforcement/*
│   ├── evaluator families  stale · oprole · task-assignment · stale-task-ownership · code-blue-manager · clinical-invariant
│   └── Strategy-A safety net  resolver throw → safe degrade to off                     [B4] authority.ts:162-172, 300-310 · dispense.service.ts:338-344
└── audit
    ├── logAudit() fire-and-forget                                                       server/lib/audit.ts
    └── closed AuditActionType union (new kinds added to union, never inferred)         server/lib/audit.ts
```

**Standing high-value secrets (must be treated as audited production secrets):**
`STABILITY_TOKEN` [A3], `ADMIN_EMAILS` [A4], `DB_CONFIG_ENCRYPTION_KEY`, `CLERK_SECRET_KEY`.

---

## 3. Authentication boundary (detail)

| Property | Status | Anchor |
|---|---|---|
| Single server-side identity truth | `CONFIRMED ✅` A1 | `clerk-session-auth.ts:14-24` |
| Role is DB-authoritative (never JWT) | `CONFIRMED ✅` A1 | `auth.ts:484`; conflict-upsert excludes `role` `:414-421` |
| Prod cannot start dev-bypass | `CONFIRMED ✅` A2 | `auth.ts:138-140`; dev branch gated `:255` |
| Stability-token bypass loopback-gated | `CONFIRMED ⚠️ by design` A3 | `auth.ts:241-253`; `stability-token.ts:2-3` |
| `ADMIN_EMAILS` first-login-only | `CONFIRMED ⚠️ by design` A4 | `admin-email-allowlist.ts:22-25`; `auth.ts:389-391` |

**Boundary owner:** `backend/http/middleware/auth.ts`. Client integration sits behind `AuthSessionPort`
(`src/infrastructure/auth`) so a Clerk-web → Clerk-Expo SDK swap is an adapter change, not an auth rewrite.

---

## 4. Authorization boundary (detail)

Two **coexisting, layered** stacks (intentional, documented), one clinical resolver:

- **Legacy/system** — `server/middleware/auth.ts` (`requireAuth`, `requireAdmin` `:671-701`,
  `requireClinicalUser` `:704-722`, `requireEffectiveRole` `:724-791`, `ROLE_HIERARCHY` `:43-52`),
  role math via `server/lib/role-resolution.ts:59-170`.
- **Clinical authority** — `server/lib/authority.ts:127-370` (`resolveAuthority`) consumed by the single
  middleware `server/middleware/authority.ts:98-239`.

Role hierarchy (numeric): `admin=40 · vet=30 · senior_technician=25 · lead_technician=22 · vet_tech=20 · technician=20 · student=10`.

**No bypass demonstrable** against sampled paths (Security Report §1.2 answer).

---

## 5. Tenant isolation boundary

> `CONFIRMED ⚠️ architectural` C1 — isolation is **100% application-enforced; no DB backstop.**

```
Tenancy
├── tenant column          every vt_ table carries clinicId (hand-written predicate on every query)   [C2]
├── tenant context         tenantContext middleware = best-effort, never rejects                       [C3] server/middleware/tenant-context.ts:24-63
├── authoritative clinicId requireAuth OVERWRITES req.clinicId from DB user                            [C3] server/middleware/auth.ts:549-551, 649-651
│   └── client never sends a trusted clinicId (response-type only)                                     [C3] src/lib/api.ts
├── mismatch handling      session clinic ≠ DB row → TENANT_MISMATCH (when DB-fallback disabled)       [C3] auth.ts:445-466
├── regression lock        cross-tenant denial + structural SELECT assertion                           [C4] tests/cross-tenant-denial.test.ts:334-368
└── NO DB backstop         no RLS, no current_setting/set_config, no CREATE POLICY anywhere            [C1] (negative search)
```

**Known gaps (defense-in-depth, low severity):** D3 — procurement `UPDATE`-by-id-only
(`procurement.ts:214-217, 360-363, 449-452`) + `containerItems` lookup/insert without `clinicId`
(`procurement.ts:294-298, 326-332`); **unproven universality** I1 (not all 309 server files swept);
`vt_po_lines`/`vt_container_items` `clinicId` columns not confirmed I2.

---

## 6. Worker execution boundary

> Workers domain rating **Good** (E1–E3). Separate process; single registration point.

```
Workers
├── orchestration      start-schedulers.ts = single registration point                  server/app/start-schedulers.ts
│   └── job runtime/registry/enqueue (BullMQ)                                            server/jobs/*
├── execution          13 workers (chargeAlert, expiryCheck, integration, sweeps, …)    server/workers/*
│   ├── idempotency     Redis cache + DB-uniqueness (durable guarantee is DB)            [E1] idempotency.ts:69,84
│   └── replay safety   confirm is status-idempotent; deduction worker is a no-op        [E2] dispense.service.ts:280-292
├── scheduling         daily crons + delayed jobs + TTL sweeps                           jobs/definitions/index.ts:63-142
└── monitoring         outbox publisher (FOR UPDATE SKIP LOCKED) + DLQ + reconciliation  [D2/E3] event-publisher.ts:60-105 · outbox-dlq-scanner.ts
```

**Known gaps:** E3/I3 — BullMQ **pilot** queues have **no DLQ** (exhausted jobs dropped+logged,
`runtime.ts:183-208`); `charge-alert attempts:1`; I4 — 32-bit `hashtext` advisory locks
(`staleCheckoutSweepWorker.ts:67,96`, `semi-dock-notify.ts:104`) vs Code-Blue's 64-bit `hashtextextended`.

---

## 7. Database ownership boundary

> Rating **Strong** (D1–D2). Owned exclusively by `backend/data` + `migrations/`.

- **Schema:** all tables prefixed `vt_`, defined in `server/schema/*.ts` (re-exported from `server/db.ts`):
  `core · equipment · inventory · tasks · ops · er · integrations · helpers`.
- **Migrations:** `migrations/` (163 files) run in order at startup and via `pnpm db:migrate`.
- **Parameterization:** all dynamic SQL via Drizzle's parameterizing `sql`/builder; the only `sql.raw`
  interpolates a 4-literal compile-time column union [D1] (`role-notification-scheduler.ts:71-80`).
- **Transactions/locks:** outbox `FOR UPDATE SKIP LOCKED`; advisory locks serialize hot paths;
  dispense confirm + PO receive in `db.transaction` [D2].

---

## 8. Infrastructure boundaries

```
Infrastructure
├── database      PostgreSQL + Drizzle pool                server/db.ts · server/schema/* · migrations/
├── queues        BullMQ + Redis (optional in dev)         server/jobs/* · server/queues/* · server/lib/{queue,redis}.ts
├── storage       uploads / object storage                 server/routes/{storage,uploads}.ts
├── messaging     push fan-out · WhatsApp · realtime SSE    server/lib/push.ts · server/routes/{push,whatsapp,realtime}.ts
└── integrations  external PMS adapter layer               server/integrations/** (adapters, webhooks, conflicts, dashboard, rollout)
```

**Native runtime bridge (not removed):** Capacitor (`capacitor.config.ts`, `ios/`, `android/`) +
plugins (NFC, haptics, deep-link, camera). Decision: **Expo/RN is north star; Ionic is frozen &
decommission-gated; Capacitor stays** (`TARGET_ARCHITECTURE.md §2`).

---

## 9. Shared libraries (the kernel)

The single bright spot the whole target is built on (F-6). Today it is **split across four locations**
and must be consolidated into `shared/`:

| Today | Holds | Target home |
|---|---|---|
| `src/core/` | entities, ports, use-cases (framework-free) | `shared/{entities,ports,use-cases}` |
| `src/lib/routes/` | nav-model (THE route table) | `shared/routes` |
| top-level `shared/*.ts` | authority, permissions, equipment-truth, contracts | `shared/{entities,contracts}` |
| `src/types/` | API contract types | `shared/contracts` |
| `lib/i18n` | typed `t`, parity, internal-key strip | `shared/i18n` |

**Hard rule (lint-enforced):** `shared/` may import only TypeScript and other `shared/`.
Rejects `react-dom`, `@ionic/*`, `@capacitor/*`, `express`, `drizzle-orm`, `wouter`, `dexie`.
*This rule is the entire Expo strategy expressed as a constraint.*

---

## 10. Cross-cutting concerns (single-owner target)

Direct restatement of the native audit's ownership matrix (left = today's owner count → right = target sole owner):

| Concern | Today | Target sole owner |
|---|---|---|
| Safe areas | **7+** | `NativeScreen` (touch) · `WebShell.Container` (desktop); strip `env(safe-area-*)` from screens |
| Header / title / back | **3** | `NativeHeader` (touch) · `WebShell.Topbar` (desktop) |
| Tab bar / bottom nav | **2** | `NativeTabBar`; delete `Layout` bottom nav |
| Scroll container | **3 roots** | `NativeScreen` (touch) · `WebShell.Container` (desktop) |
| Keyboard | **0 global / 1 ad-hoc** | `KeyboardPort` wired in `NativeShell` |
| Status bar | **0 native** | `StatusBarPort` wired in `NativeShell.StatusBar` |
| Platform target switch | **2 (platform + viewport)** | `PlatformRouter` / `resolvePlatformTarget()` |
| Navigation outlet | **1 router / 0 native semantics** | per-shell outlet over one shared route table |
| Identity / auth | 1 (correct) | `backend/` auth middleware — **preserve** |
| Clinical authority | 1 (correct) | `backend/` `resolveAuthority` — **preserve** |
| Tenancy predicate | app-only | `backend/` query layer **+ RLS backstop** (added) |
| Offline sync | 1 (correct) | `offline/` sync-engine — **preserve** |
| Client state | mixed (+ unused Zustand) | React Query (server) · Dexie (offline) · authStore (session) · router (URL); remove Zustand |

---

## 11. Frozen surfaces (must survive the rebase byte-for-byte)

Per `CLAUDE.md` + `NATIVE_ARCHITECTURE.md §7` — **out of bounds** for any refactor; reorg **relocates
behind boundaries, never rewrites**:

- SSE realtime transport (`/api/realtime/stream`, outbox cursor, replay) — not WebSockets/polling.
- BroadcastChannel envelope (`cursor`, `buildTag`, `ts`, `senderNonce`, bounded `kind`).
- Emergency-endpoint **cache denylist** (`/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/*`).
- PWA build-tag (`__VT_BUILD_TAG__`) → SW cache name + split-version detector.
- Offline-emergency-block (Code Blue mutations fail loud offline; never queued).
- Enforcement envelope `off|shadow|enforce` + **Strategy-A safety net** (never retired).
- `appointmentsPage.*` i18n namespace, `vt_appointments` table, `/api/appointments` route (rename copy only).
- Bounded telemetry enums (no high-cardinality fields).
- Service worker stays registered (`src/main.tsx`).

---

## 12. Migration posture (where the repo is today)

This is a repo **mid-convergence**, not greenfield. Already present:
- `src/shared/platform/PlatformRouter.tsx` (the single switch — Phase 2 partially landed)
- `src/native/{NativeShell,NativeScreen,NativeTabBar}.tsx` (Phase 3 scaffolding)
- `src/desktop/WebShell.tsx` (Phase 4 scaffolding)
- `src/core/` + `src/infrastructure/` (Phase 1 kernel/ports seam, F-6)
- `.dependency-cruiser.cjs` + `.github/CODEOWNERS` (Phase 0 guardrails)
- legacy still live in parallel: `src/shell/mobile/MobileShell.tsx`, `src/app/routes.tsx`, top-level `shared/`, `lib/i18n`

The remaining work is **retire-as-you-go** convergence (kill the duplicate owner at each step), exactly
as `MIGRATION_PLAN.md` sequences it. This map is the fixed reference those moves are checked against.
