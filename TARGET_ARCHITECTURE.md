# TARGET_ARCHITECTURE.md

> **Type:** Target architecture (design only — **not** an implementation).
> **Inputs:** `NATIVE_ARCHITECTURE.md` (forensic native/architecture audit) · `SECURITY_REPORT.md` (forensic security & verification audit).
> **Date:** 2026-06-26 · **Branch:** `claude/youthful-mayer-5910xf`
> **Companion:** `MIGRATION_PLAN.md` (phases, risks, ownership model, dependency graph, Expo compatibility).
>
> **Method:** Every target decision is justified against a finding in the two audits (cited as `F-n`, `Ax`, `Bx`, `Cx`, `Dx`, `Ex`, `Fx`, `In`) and anchored to a real `file:line` in the current tree. This document describes the **end state**; the route from here to there lives in `MIGRATION_PLAN.md`. Nothing here is built yet.

---

## 0. Scope

The two audits agree on the disease and disagree on nothing:

- **Native audit verdict:** VetTrack is *“a web-first PWA wrapped in Capacitor, with a thin Ionic veneer (`IonApp` only) and a partially-built parallel native shell grafted on top. Three UI paradigms ship in one bundle and are active simultaneously … every cross-cutting native concern has two to seven competing owners.”* (`NATIVE_ARCHITECTURE.md` §0)
- **Security audit verdict:** the **server** is in good shape — *“Authentication: Strong; Authorization: Strong; Multi-tenant isolation: Good but app-only; Database: Strong; Workers: Good; State: Good; Webhooks: Strong; Tests: Strong.”* (`SECURITY_REPORT.md` §4)

So the target architecture has an asymmetric mandate:

| Half | Mandate |
|------|---------|
| **Client / shells / native** | **Re-architect.** Assign one owner per concern, one shell per target, make screens chrome-agnostic, and build the seam an Expo/React-Native migration needs. |
| **Backend / workers / tenancy / auth** | **Preserve and harden.** Keep every confirmed-secure property byte-for-byte; add the three backstops the security audit recommends (RLS, pilot-queue DLQ, predicate lint). Do **not** refactor what is already Strong. |

This document defines the target for all six requested domains — `native/`, `desktop/`, `shared/`, `backend/`, `workers/`, `offline/` — plus the runtime tree the brief asked to evaluate and refine.

---

## 1. Two governing principles

Everything below is derived from exactly two rules.

> **P1 — One owner per concern.** Each cross-cutting concern (safe areas, scrolling, headers, tab bar, keyboard, status bar, navigation, identity, tenancy, sync) is owned by **exactly one** component or layer. Screens and routes are *consumers*, never *owners*. This directly retires the 2-to-7-owner sprawl in the native audit’s ownership matrix.

> **P2 — One shell per target, fed by one shared kernel.** Each runtime target (touch, pointer, public-web) has exactly one shell. Every shell renders the **same** route table and depends on the **same** framework-free kernel (`shared/`). Presentation is a leaf; logic is shared. This is what makes the eventual Expo port a *replacement of one leaf* instead of a rewrite.

---

## 2. The one consequential decision: resolve the Ionic ↔ Expo fork

The native audit names this the root of the waste:

> *“ADR-001 commits the team to Option C — Capacitor + Ionic React … **None of those primitives exist in the codebase.** The project pays Ionic’s full cost … and receives none of its native benefit.”* (`NATIVE_ARCHITECTURE.md` §0, F-2)

…and warns:

> *“**Ionic is a dead end for Expo.** If RN is the real destination, adopting more Ionic (Q5 option A) is throwaway work. Decide ADR-001’s true target *before* investing further in either Ionic or `Layout`.”* (`NATIVE_ARCHITECTURE.md` §7)

The brief names **“Expo migration compatibility”** as a required output. That is the deciding signal. The target therefore resolves the fork as:

> ### Decision: **Expo / React Native is the north star. Ionic is frozen and decommission-gated. Capacitor stays as the native runtime bridge until the Expo cut-over.**
>
> - We do **not** adopt `IonRouterOutlet` / `IonTabBar` / `IonModal` / `IonSegment`. Building more Ionic is throwaway work against an RN destination.
> - `@ionic/react` + `@ionic/core` are quarantined behind a single removable boundary (`IonApp`) and slated for deletion (amend ADR-001 → Option B "Capacitor + own shell, RN-bound"). See §4.
> - The native *navigation* benefits the ADR promised (push/pop, swipe-back, per-tab stacks, `ADR-001:53`) are delivered by an **Expo-portable router abstraction** owned by the mobile shell — not by Ionic.
> - Capacitor is **not** the thing being removed. NFC/haptics/deep-link/camera plugins and the `ios/`+`android/` projects remain the native bridge; Expo can consume the same native modules at cut-over.

This decision is what makes the six-domain layout below coherent: `shared/` is the keep, `native/` (DOM today) is the throwaway-at-Expo leaf, and Ionic is simply not in the dependency graph anyone relies on.

---

## 3. Domain architecture — the six target domains

The target source tree is reorganized from "by technical layer inside `src/` and `server/`" into **six dependency-bounded domains**. These are logical domains with enforced import rules (a lint boundary), physically realized during migration (see `MIGRATION_PLAN.md` Phase 1+). They are **not** claimed to exist today.

### 3.1 Domain map

| Domain | Owns | Depends on | Process | Expo disposition |
|--------|------|------------|---------|------------------|
| **`shared/`** | Framework-free kernel: entities, use-cases, **ports**, the **route table / nav-model**, API contract types, permissions, i18n keys | **nothing** (no DOM, no Capacitor, no Ionic, no Express, no Drizzle, no wouter) | n/a (compiles into client & server) | **Keep 100%.** This is the Expo seam. |
| **`native/`** | Touch presentation: `NativeShell` + `StatusBar`/`NativeHeader`/`NativeScreen`/`NativeTabBar`, `MobileRouter`, native screens, Capacitor adapters (impl. of `shared/` ports) | `shared/`, `offline/` | client | **Replace at Expo** (DOM → RN). The only large throwaway. |
| **`desktop/`** | Web/pointer presentation: `WebShell` (Topbar + Sidebar + Container), `DesktopRouter`, desktop pages, **`MarketingShell`** (public, chrome-free) | `shared/`, `offline/` | client | Keep (web stays web; optionally `react-native-web` for PWA — §9). |
| **`offline/`** | Offline-first + sync + PWA: Dexie store, sync-engine (queue/retry/circuit-breaker/conflict store), **service worker**, offline-emergency-block, realtime client reconciliation, IndexedDB adapters (impl. of `shared/` ports) | `shared/` | client | Keep contracts; **swap adapters** (Dexie → SQLite/MMKV) behind ports. |
| **`backend/`** | Express API: routes, services, schema, migrations, middleware (**auth, authority, tenant-context**), integrations/PMS webhooks, realtime SSE endpoints, db pool | `shared/` | server (`pnpm dev` / `pnpm start`) | **Keep 100%.** Untouched by the client migration. |
| **`workers/`** | Background processing: BullMQ workers + schedulers, job runtime/registry, realtime **outbox publisher**, DLQ + reconciliation scanners, idempotency contract | `shared/`, `backend/` (schema, services) | separate process (`pnpm worker`) | **Keep 100%.** |

### 3.2 `shared/` — the kernel (the Expo on-ramp)

The native audit’s single bright spot is the thing we build everything on:

> *“`src/core/` is framework-free TypeScript … `src/infrastructure/` holds platform adapters behind interfaces … **This is exactly the seam an Expo/React-Native migration needs** — pure logic and ports that don’t import React DOM.”* (`NATIVE_ARCHITECTURE.md` F-6)

**Target contents** (consolidates today’s `src/core/`, `src/lib/routes/`, top-level `shared/`, `src/types/`, `lib/i18n`):

```
shared/
  entities/          design tokens, equipment-truth, authority types, permissions (from src/core/entities + shared/*.ts)
  use-cases/         offline-emergency-block, equipment-readiness-rules, handoff-debt (pure rules)
  ports/             interfaces ONLY — the platform contract:
                       NfcPort · HapticsPort · DeepLinkPort · StatusBarPort · KeyboardPort
                       CachePort · SyncQueuePort · ApiClientPort · AuthSessionPort
  routes/            nav-model.ts (THE route table) + resolve-nav-active, canonical-hrefs, route-family-ids
  contracts/         API request/response types (from shared/contracts + src/types)
  i18n/              typed keys + locales (he default, en) — parity-enforced
```

**Hard rule (lint-enforced):** `shared/` may import only TypeScript and other `shared/`. A test/AST rule rejects any import of `react-dom`, `@ionic/*`, `@capacitor/*`, `express`, `drizzle-orm`, `wouter`, `dexie`. *This rule is the whole Expo strategy expressed as a constraint.*

`shared/routes/nav-model.ts` is already the single source of truth — *“Both Topbar and Sidebar and the mobile bottom-nav consume THIS and nothing else”* (`src/lib/routes/nav-model.ts:1-2`). The target only **relocates** it into the kernel and forbids any shell from defining its own nav.

### 3.3 `native/` — the touch presentation domain

Replaces the hand-rolled `src/shell/mobile/MobileShell.tsx` (two `<div>`s with inline styles, `MobileShell.tsx:15-35`) and the five forked `*Screen.tsx` variants with a **single real shell that owns all native chrome**.

```
native/
  shell/
    NativeShell.tsx        composition root; SOLE owner of native chrome (P1)
    StatusBar.tsx          → StatusBarPort  (one owner; today 0, SEC-grade gap, F: "0 native owners")
    NativeHeader.tsx       title + back affordance (one owner; today 3 competing)
    NativeScreen.tsx       THE scroll container + safe-area edge + keyboard avoidance (today: 3 scroll roots, 7 safe-area owners)
    NativeTabBar.tsx       the one tab bar over shared nav-model (today: 2 parallel impls)
  router/
    MobileRouter.tsx       native-aware outlet (stack history/push-pop/swipe-back); Expo-portable; NOT IonRouterOutlet
  screens/                 pure content. A screen NEVER reads env(safe-area-*), sets a scroll root, or draws a tab bar.
  platform/                Capacitor adapters implementing shared/ports:
                             NfcAdapter · HapticsAdapter · DeepLinkAdapter · StatusBarAdapter(@capacitor/status-bar) · KeyboardAdapter(@capacitor/keyboard)
```

Serves **both** Capacitor-native **and** installed-PWA / mobile-Safari users — fixing F-5 (today only Capacitor gets the native shell; *“every other mobile user gets the old web shell”*). Platform differences (status bar, keyboard) live behind ports, so one shell implementation drives both runtimes.

### 3.4 `desktop/` — the web/pointer presentation domain

The brief’s `WebShell`. Equals the native audit’s recommended `DesktopShell` — *“Its only defensible job is the desktop `PageShell` (Topbar + Sidebar) … rename to `DesktopShell`, delete its mobile/native branches”* (`NATIVE_ARCHITECTURE.md` Q3).

```
desktop/
  shell/
    WebShell.tsx           Topbar + Sidebar + Container (relocated AppShell→PageShell)
    Sidebar.tsx            NAV-driven from shared/routes/nav-model
    Container.tsx          THE desktop scroll container (one owner)
  router/
    DesktopRouter.tsx      wouter <Switch> over the shared route table
  pages/                   desktop WebPage implementations (pure content)
  marketing/
    MarketingShell.tsx     public, unauthenticated, chrome-free (landing/privacy/terms) — viewport-responsive
```

`AppShell.tsx`’s 3-way dispatch (`AppShell.tsx:41-67`) collapses: its `insideMobileShell` pass-through (`:44`) and its `Layout` (web-mobile) branch (`:56-67`) are deleted; only the `PageShell` branch survives as `WebShell`. The 1548-LOC `Layout` is retired once mobile-web routes through `NativeShell`.

### 3.5 `offline/` — offline-first, sync, PWA

Single owner of client persistence and sync. The security audit confirms this layer is already **Good** (F1) and must be preserved; the target only gives it a domain boundary and puts its storage behind ports for Expo.

```
offline/
  db/                    Dexie schema (equipment cache, rooms cache, pending-sync queue, conflict store)
  sync-engine/           FIFO queue, retry, circuit-breaker, 409→conflict store, bounded result taxonomy
  emergency/             offline-emergency-block classifier (FROZEN: Code Blue never queued)
  realtime/              SSE client reconciliation (replay + snapshot) — FROZEN transport
  pwa/                   service worker (build-tag cache, emergency denylist) — FROZEN
  adapters/              CacheAdapter, SyncQueueAdapter implementing shared/ports (Dexie today)
```

> **Frozen-surface note (CLAUDE.md + `NATIVE_ARCHITECTURE.md` §7):** the SSE transport, BroadcastChannel envelope, **emergency-endpoint cache denylist**, build-tag, and offline-emergency-block are load-bearing. The `offline/` reorg is a **relocation behind a boundary**, not a rewrite. *Removing the service worker would break PWA offline + the Code Blue cache bypass — explicitly out of bounds.*

### 3.6 `backend/` — Express API (preserve & harden)

The security audit verified this layer in depth. The target **preserves every confirmed property** and adds only the recommended backstops.

```
backend/
  http/        routes/ (≈44 modules, registered in app/routes.ts), middleware/ (auth, authority, tenant-context, rate-limiters, validate)
  services/    domain services (dispense, procurement, equipment, code-blue, …)
  domain/      server-side domain logic
  data/        schema/ (vt_* tables), db.ts pool, migrate.ts, seed.ts
  realtime/    SSE stream/replay/outbox endpoints (FROZEN)
  integrations/ PMS webhook inbound/outbound (svix + constant-time HMAC)
```

**Preserved security properties** (do not regress — `SECURITY_REPORT.md` §1):
- **A1** — single server-side identity truth; role read from `vt_users.role` (`auth.ts:484`), never JWT; conflict-upsert excludes `role` (`auth.ts:414-421`).
- **A2** — production cannot start in dev-bypass (`auth.ts:138-140`); dev overrides gated on `isDevelopment` (`auth.ts:255`).
- **A3/A4** — stability-token loopback-gated (`auth.ts:241-253`); `ADMIN_EMAILS` first-login-only.
- **B1–B4** — one clinical resolver `resolveAuthority` (`authority.ts:127-370`); explicit per-stack admin-bypass; type-enforced student ceiling (`shared/authority.ts:33-43`); enforcement envelope `off|shadow|enforce` with **Strategy-A safety net**.
- **C3** — client never supplies a trusted `clinicId`; `requireAuth` overwrites from DB user (`auth.ts:549-551`).
- **D1/D2** — consistent parameterization, correct transactions/locks, global XSS sanitization.

**Added backstops** (security audit prioritized remediations §4):
- **Tenancy RLS backstop** (C1/I1) — see §5.6.
- **D3 fix** — explicit `eq(table.clinicId, clinicId)` on the procurement `UPDATE`s (`procurement.ts:214-217,360-363,449-452`) and the `containerItems` lookup/insert (`procurement.ts:294-298,326-332`).
- **`clinicId` co-presence lint** (I1) — AST rule asserting every `vt_`-table predicate filtering by `id` also filters by `clinicId`.

### 3.7 `workers/` — background processing (preserve & harden)

Elevated to a top-level domain because it is a **separate process** (`pnpm worker`) with its own lifecycle and scaling, and the security audit treats Workers as its own domain (**Good**, E1–E3).

```
workers/
  registry/    start-schedulers.ts (single registration point), job definitions, registry, queue-factory, enqueue
  workers/     chargeAlert, expiryCheck, integration, staleCheckInSweep, staleTaskOwnershipSweep, taskOwnershipBackfill, notification, …
  outbox/      event-publisher (FOR UPDATE SKIP LOCKED), outbox janitor, DLQ scanner, code-blue reconciliation scanner
```

**Preserved** (E1–E3): DB-uniqueness idempotency (`idempotency.ts:69,84`), status-idempotent confirm (`dispense.service.ts:280-292`), bounded retry/backoff, outbox + notification DLQs.
**Added** (E3/I3/I4): a **pilot-queue DLQ + failure alarm** (`runtime.ts:183-208` today drops exhausted jobs); reconsider `charge-alert attempts:1`; upgrade 32-bit `hashtext` advisory locks to 64-bit `hashtextextended`.

---

## 4. The runtime tree — evaluated and refined

The brief asked to *evaluate and refine* this tree:

```
IonApp → PlatformRouter
   mobile → NativeShell { StatusBar, NativeHeader, NativeScreen, NativeTabBar }
   desktop → WebShell  { Sidebar, Container, WebPage }
```

### 4.1 Evaluation

The shape is **directionally correct and a large improvement** over what executes today (`App.tsx:40-46` forks on `useIsMobile()` into `MobileShell` or bare `AppRoutes`). It correctly:
- introduces a **single** platform switch (`PlatformRouter`) — retiring the *“two switches deciding the same thing on different axes”* root cause (`NATIVE_ARCHITECTURE.md` §4.3: `App.tsx` branches on platform, `AppShell` on viewport);
- gives the mobile branch **named chrome owners** (StatusBar / NativeHeader / NativeScreen / NativeTabBar), which is exactly P1.

It is **incomplete or wrong** in six ways:

| # | Issue with the proposed tree | Refinement | Grounded in |
|---|------------------------------|-----------|-------------|
| R1 | `IonApp` sits at the root as if load-bearing | Demote to an **optional, removable boundary** (the Ionic decommission gate). Nothing below it may import Ionic. | F-2; §2 decision |
| R2 | `PlatformRouter` is **2-way** (mobile/desktop) — but the bundle serves **three** live targets (marketing web, installed PWA, Capacitor). 2-way re-creates F-5 (mobile-web falls through). | Make it **3-way**: `mobile · desktop · marketing`, via one `resolvePlatformTarget()`. | F-1, F-5 |
| R3 | `NativeScreen` is undefined — but scrolling (3 roots) and safe areas (7 owners) and keyboard (0 owners) are the worst offenders | `NativeScreen` **explicitly owns** the scroll container, the safe-area edge, **and** keyboard avoidance. | ownership matrix |
| R4 | No router between shell and screen — repeats the *“1 router, 0 native semantics”* gap | Insert **`MobileRouter`** / **`DesktopRouter`** outlets, both rendering the **one `shared/` route table**. | Q5; F: navigation |
| R5 | Providers are implicit | Make **`Providers`** explicit (Clerk · Query · Settings · Sync · Confirm), between `IonApp` and `PlatformRouter` — unchanged from `main.tsx`. | `main.tsx` |
| R6 | One shell can’t serve native + mobile-web if it hard-depends on Capacitor | Drive `NativeShell` chrome through **ports** (`StatusBarPort`, `KeyboardPort`) so one impl serves both runtimes. | F-5; F-6 |

`WebShell { Sidebar, Container, WebPage }` is accepted as-is and mapped to `desktop/` (§3.4); `MarketingShell` is added as the third shell.

### 4.2 Refined target tree

```
<IonApp>                         ◄ R1: OPTIONAL, removable boundary (Ionic decommission gate).
                                     Provides only Ionic's platform CSS class. Nothing below imports Ionic.
                                     Deleting it is one commit (amend ADR-001 → Option B).
  └── <Providers>                ◄ R5: Clerk · QueryClient · Settings · Sync · Confirm  (unchanged from main.tsx)
        └── <PlatformRouter>     ◄ R2: ONE switch. resolvePlatformTarget() → "mobile" | "desktop" | "marketing"
                                     Replaces BOTH useIsMobile() (platform) AND AppShell's matchMedia (viewport).

           ├── target = "mobile" ──► <NativeShell>            ◄ SOLE OWNER of native chrome (P1). Native + mobile-web.
           │      owns: safe areas (once) · scroll · header/title · tab bar · keyboard · status bar · nav stack
           │        ├── <StatusBar/>      → StatusBarPort   (R6: @capacitor/status-bar | PWA theme-color)
           │        ├── <NativeHeader/>   title + back affordance
           │        ├── <NativeScreen/>   ◄ R3: THE scroll container + safe-area edge + keyboard avoidance
           │        │     └── <MobileRouter/>   ◄ R4: native-aware outlet over shared/ route table (Expo-portable)
           │        │           └── <Screen/>   pure content — NEVER reads env(safe-area-*), never sets scroll root
           │        └── <NativeTabBar/>   one tab bar over shared/ nav-model
           │
           ├── target = "desktop" ─► <WebShell>               (relocated AppShell→PageShell)
           │        ├── <Sidebar/>        NAV-driven from shared/ nav-model
           │        ├── <Container/>      THE desktop scroll container
           │        │     └── <DesktopRouter/>  wouter <Switch> over shared/ route table
           │        │           └── <WebPage/>  pure content
           │        └── <Topbar/>
           │
           └── target = "marketing" ► <MarketingShell>        public, chrome-free, viewport-responsive
                     └── <PublicPage/>  (landing · privacy · terms)
```

`resolvePlatformTarget()` (lives in `shared/`, capability-checked at the edge by an adapter):

```
isPublicRoute(path)                       → "marketing"     (unauthenticated surface; fixes F-1 leakage)
else isCapacitorNative() || isTouchNarrow → "mobile"        (fixes F-5: PWA/mobile-Safari now enter NativeShell)
else                                      → "desktop"
```

This is the single decision the whole client makes about which shell to mount. It subsumes `use-is-mobile.ts:7-9` and `AppShell.tsx:42`’s `useIsDesktop()` — the two switches become one.

---

## 5. Cross-cutting contracts (the `Define:` list)

### 5.1 Routing

- **One route table** — `shared/routes/nav-model.ts` (already the SSoT). No shell defines its own routes.
- **Per-shell outlets** render that table: `DesktopRouter` (wouter), `MobileRouter` (Expo-portable stack), `MarketingRouter` (static). The global subtree-swapping `wouter <Switch>` (`routes.tsx:85-181`) is decommissioned in favor of shell-scoped outlets.
- **Why per-shell:** the table is portable; the *outlet* is not. Keeping the **table** as the seam makes the Expo-Router swap mechanical (the audit’s named router lock-in risk, §7).

### 5.2 Navigation

- One nav model rendered three ways: `NativeTabBar` (touch), `Sidebar`/`Topbar` (desktop), none (marketing).
- Active-state resolution shared (`shared/routes/resolve-nav-active.ts`).
- Native gets a **real stack**: push/pop transitions, swipe-back, per-tab history — the ADR’s promised benefits (`ADR-001:53`), delivered by `MobileRouter`, **not** Ionic.

### 5.3 Shells

| Shell | Target | Owns | Screen contract |
|-------|--------|------|-----------------|
| `NativeShell` | touch (native + PWA) | status bar, header, scroll, tab bar, keyboard, safe areas, nav stack | content only |
| `WebShell` | pointer / ≥1024px | topbar, sidebar, scroll | content only |
| `MarketingShell` | public web | nothing (chrome-free) | full-bleed page |

A screen that touches `env(safe-area-inset-*)`, `100dvh`, `matchMedia`, document scroll, or draws a tab bar is a **contract violation** and a lint target.

### 5.4 Ownership — the single-owner end-state matrix

Direct replacement of the native audit’s ownership matrix. Left = today’s owner count; right = the one target owner.

| Concern | Today | **Target sole owner** |
|---------|-------|-----------------------|
| Safe areas | **7+** | `NativeScreen` (touch) · `WebShell.Container` (desktop). `body`/`.app-shell` global insets removed; `env(safe-area-*)` stripped from all screens. |
| Header / title / back | **3** | `NativeHeader` (touch) · `WebShell.Topbar` (desktop) |
| Tab bar / bottom nav | **2** | `NativeTabBar`. `Layout`’s bottom nav deleted. |
| Scroll container | **3 roots** | `NativeScreen` (touch) · `WebShell.Container` (desktop) |
| Keyboard | **0 global / 1 ad-hoc** | `KeyboardPort` wired in `NativeShell` |
| Status bar | **0 native** | `StatusBarPort` wired in `NativeShell.StatusBar` |
| Platform target switch | **2 (platform + viewport)** | `PlatformRouter` / `resolvePlatformTarget()` |
| Navigation outlet | **1 router, 0 native semantics** | per-shell outlet over one shared table |
| Identity / auth | 1 (already correct) | `backend/` auth middleware (DB-authoritative) — **preserve** |
| Clinical authority | 1 (already correct) | `backend/` `resolveAuthority` — **preserve** |
| Tenancy predicate | app-only | `backend/` query layer **+ RLS backstop** (§5.6) |
| Offline sync | 1 (already correct) | `offline/` sync-engine — **preserve** |
| Client state | mixed (+ unused Zustand) | §5.9 |

### 5.5 Auth (target = preserve the Strong rating)

No structural change — the security audit rated this **Strong** and the target must not regress it (§3.6 A1–A4, B1–B4, C3). The architecture only **places** it: identity + authority live exclusively in `backend/`; `shared/` carries auth **types** (roles, permissions, the type-enforced student ceiling) but **never** secrets, the resolver, or a session reader. The client auth integration sits behind `AuthSessionPort` (`infrastructure/auth`) so the Clerk-web → Clerk-Expo SDK swap is an adapter change. Treat `STABILITY_TOKEN` / `ADMIN_EMAILS` as audited production secrets (A3/A4 business-impact note).

### 5.6 Tenancy (target = add the DB backstop the audit asked for)

The security audit’s one architectural caveat:

> *“Isolation is 100% application-enforced; **no DB backstop** … A single omitted `clinicId` predicate is a cross-tenant exposure with no second line of defense.”* (`SECURITY_REPORT.md` C1) — and universality is **unproven** (I1).

**Target = defense in depth:**
1. **Keep** the hand-written `clinicId` predicate on every query (C2/C4 discipline — unchanged).
2. **Add** a PostgreSQL **RLS backstop**: per-request `set_config('app.current_clinic_id', clinicId, true)` inside the tenant transaction + `CREATE POLICY … USING (clinic_id = current_setting('app.current_clinic_id'))` on every `vt_` table. Converts I1 from *“trust + sampling”* into a database guarantee.
3. **Add** the `clinicId` co-presence **AST/lint** rule (I1) and fix the D3 id-only `UPDATE`s.
4. **Rollout** mirrors the authority envelope: `shadow` (log would-block) → `enforce`, because **workers run without a user** and system/cross-clinic jobs must be granted an explicit `app.current_clinic_id` (or a bypass role) before any policy is set to `enforce`. (See `MIGRATION_PLAN.md` risk R-T.)

Dev-bypass `clinicId = "dev-clinic-default"` is unchanged. The client never sends a trusted `clinicId` (C3) — unchanged.

### 5.7 Workers (target = preserve Good, close the two gaps)

Single registration point (`start-schedulers.ts`), separate process. Idempotency = Redis cache + DB uniqueness (unchanged, E1–E2). **Close:** add a pilot-queue DLQ + alarm (E3/I3); reconsider `charge-alert attempts:1`; 64-bit advisory locks (I4). Realtime **outbox publisher** (`FOR UPDATE SKIP LOCKED`, `event-publisher.ts:60-105`) is a frozen surface — preserved exactly.

### 5.8 Sync (target = preserve, put storage behind ports)

`offline/` sync-engine remains the single owner: FIFO queue, retry, circuit-breaker, 409→conflict store (`sync-engine.ts:392-416`). **Frozen:** emergency mutations never queued (`offline-emergency-block.ts`); SW emergency denylist; build-tag cache; SSE replay+reconciliation (no polling). **Expo-readiness:** persistence is behind `CachePort` / `SyncQueuePort`, so Dexie → SQLite/MMKV is an adapter swap, not a sync rewrite.

### 5.9 State management (target = one owner per kind of state)

The security audit found the model is sound but carries dead weight:

> *“React Query (server state) + a hand-rolled module store in `src/lib/api.ts` (`authStore`) + Dexie (offline) … **`zustand@^5.0.12` … has zero imports anywhere in `src/`**.”* (`SECURITY_REPORT.md` F2)

**Target — explicit ownership per state kind:**

| State kind | Owner | Notes |
|-----------|-------|-------|
| Server / remote data | **React Query** (TanStack) | the only server-state cache. Ports to RN unchanged. |
| Offline / persisted | **Dexie** via `offline/` (behind ports) | RN swaps the adapter, not the callers. |
| Auth / session glue | the minimal module store (`authStore`, `api.ts:107,148`) | relocate behind `AuthSessionPort` |
| URL / view state | the router (`?scan=1`, active tab, filters) | per §5.1 |
| Realtime | SSE → React Query invalidation | **not** a separate store (frozen) |

**Decision on Zustand:** **remove it** unless a concrete cross-cutting client-state need appears (YAGNI; an unused dependency is dead supply-chain surface — F2). If such a need does appear, Zustand becomes *the* single ephemeral-UI-state store and `authStore` migrates into it — one store, not a parallel one. Either way: no Zustand ↔ React Query overlap (the property the audit confirmed by its absence).

---

## 6. Frozen surfaces (must survive the target untouched)

Per `CLAUDE.md` and `NATIVE_ARCHITECTURE.md` §7, these are load-bearing and **out of bounds** for any shell refactor:

- SSE realtime transport (`/api/realtime/stream`, outbox cursor, replay) — **not** WebSockets/polling.
- BroadcastChannel envelope (`cursor`, `buildTag`, `ts`, `senderNonce`, bounded `kind`).
- Emergency-endpoint **cache denylist** (`/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/*`).
- PWA build-tag (`__VT_BUILD_TAG__`) → SW cache name + split-version detector.
- Offline-emergency-block (Code Blue mutations fail loud offline; never queued).
- Enforcement envelope `off|shadow|enforce` + **Strategy-A safety net** (never retired).
- `appointmentsPage.*` i18n namespace, `vt_appointments` table, `/api/appointments` route (rename copy only).
- Bounded telemetry enums (no high-cardinality fields).

The domain reorg **relocates code behind boundaries**; it does not rewrite these. The service worker stays registered (`main.tsx:115`).

---

## 7. Dependency graph (acyclic) — and the Expo swap surface

```
                         ┌──────────────┐
                         │   shared/    │   pure TS · imports NOTHING · the kernel/SSoT
                         └──────▲───────┘
        ┌───────────────┬───────┼─────────┬────────────────┐
        │               │       │         │                │
   ┌────┴────┐    ┌─────┴───┐   │    ┌────┴─────┐    ┌──────┴─────┐
   │ native/ │    │desktop/ │   │    │ offline/ │    │  backend/  │
   │ (touch) │    │ (web)   │   │    │(sync/PWA)│    │ (Express)  │
   └────┬────┘    └────┬────┘   │    └────▲─────┘    └──────▲─────┘
        │              │        │         │                 │
        └──────────────┴────────┼─────────┘          ┌──────┴─────┐
            both client shells depend on             │  workers/  │
            shared/ + offline/                        │ (BullMQ)   │
                                                      └────────────┘
                                                   workers/ → shared/ + backend/
```

**Adjacency (allowed imports only):**
- `shared/` → ∅
- `backend/` → `shared/`
- `workers/` → `shared/`, `backend/`
- `offline/` → `shared/`
- `native/` → `shared/`, `offline/`
- `desktop/` → `shared/`, `offline/`

**Properties:** acyclic; `shared/` is the universal sink; no domain depends on a presentation domain. **No client shell depends on another shell** (kills the `AppShell`→`MobileShell` cross-talk and the dual-tree forks, F-3/F-4).

**Expo swap surface (highlighted):** an Expo/RN migration touches **only `native/`** (DOM → RN) plus `offline/`’s **adapters** (Dexie → SQLite). `shared/`, `backend/`, `workers/`, and every contract stay byte-for-byte. That is the entire point of the graph.

---

## 8. Open decisions / gates (resolve before the dependent phase)

| Gate | Question | Default in this target | Blocks |
|------|----------|------------------------|--------|
| **G1 — Ionic decommission** | Delete `@ionic/*` now, or keep `IonApp` as inert boundary until Expo? | Keep inert, delete at Phase 7 (amend ADR-001 → Option B). | Phase 7 |
| **G2 — mobile-web at Expo** | When `native/` goes RN, what serves PWA/mobile-Safari (no RN runtime)? | `react-native-web` over the same `native/` source, **or** retain a DOM `NativeShell`. Decide at Phase 7. | Phase 7 / §9 |
| **G3 — RLS enforce cutover** | When do tenancy policies flip `shadow`→`enforce`? | After all worker/system contexts carry an explicit `app.current_clinic_id`. | Phase 6 |
| **G4 — `MobileRouter` choice** | Which Expo-portable router abstraction? | A thin stack router over the shared table that maps 1:1 onto Expo Router; **never** `IonRouterOutlet`. | Phase 5 |

---

## 9. Expo / React-Native compatibility (summary; full plan in `MIGRATION_PLAN.md`)

| Asset | Expo disposition | Mechanism |
|-------|------------------|-----------|
| `shared/` (entities, use-cases, ports, route table, contracts, i18n) | **Port unchanged** | already framework-free (F-6) |
| `backend/`, `workers/` | **Untouched** | server-side; Expo is a client concern |
| React Query | **Port unchanged** | RN-supported |
| `offline/` sync-engine | **Keep**; swap storage adapter | `CachePort`/`SyncQueuePort` → SQLite/MMKV |
| Capacitor plugins (NFC/haptics/deep-link/camera) | **Re-bind** behind same ports | Expo modules / config plugins consume the same native code |
| `native/` shell + screens (DOM) | **Re-implement in RN** | the one large throwaway; `react-native-web` can serve PWA from the same source (G2) |
| `desktop/` + `MarketingShell` | **Stay web** | unaffected |
| **Liabilities to contain now** | `env(safe-area-*)`, `100dvh`, `matchMedia`, Radix portals, `framer-motion`, `wouter` | each is non-portable; the target confines them to shells so the RN port is small (audit §7) |
| **Dead end** | `@ionic/*` | quarantined at `IonApp`, deleted at G1 |

---

### One-line target

> **One kernel (`shared/`), one shell per target (`NativeShell` · `WebShell` · `MarketingShell`), one owner per concern, one route table — with the backend left Strong and hardened, Ionic quarantined for deletion, and `native/` as the only leaf an Expo migration has to replace.**
