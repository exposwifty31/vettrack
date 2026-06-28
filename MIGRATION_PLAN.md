# MIGRATION_PLAN.md

> **Type:** Migration plan (design only — sequencing, not code).
> **Companion:** `TARGET_ARCHITECTURE.md` (the end state). Read it first; this document is *how to get there*.
> **Inputs:** `NATIVE_ARCHITECTURE.md` · `SECURITY_REPORT.md`.
> **Date:** 2026-06-26 · **Branch:** `claude/youthful-mayer-5910xf`

---

## 0. Strategy

Two non-negotiables, taken straight from the audits:

1. **Convergence before migration.** The native audit is explicit: *“A migration was declared but executed as an addition. Capacitor + Ionic were layered on top of the PWA instead of replacing it. Nothing was retired.”* (`NATIVE_ARCHITECTURE.md` §4.1). So we **retire as we go** — every phase deletes a competing owner, it does not add a third.
2. **Preserve the Strong backend.** The security audit rated backend/auth/workers/state Good-to-Strong. We do not refactor them for tidiness; we only add the three named backstops. *Touching frozen surfaces is a regression, not progress* (`TARGET_ARCHITECTURE.md` §6).

**Shape of the plan:** eight phases. Phases **0–5** are the in-repo convergence (web + Capacitor, no RN). Phase **6** is backend/tenancy/worker hardening. Phase **7** is the Expo on-ramp. **Every phase is independently shippable and independently reversible** — none requires the next to be valuable, and each leaves `tsc` green and the frozen surfaces intact.

> **Verification rule for every phase (audit §7):** *“Realtime / PWA work needs browser verification.”* `tsc` + vitest cover counter contracts; **scroll, safe-area, and navigation changes must be verified in a real browser and a real WKWebView**, not just type-checked. The Playwright drills (`tests/phase-9-drills.spec.ts`) must pass before any Phase-9-adjacent change is called done.

---

## 1. Phase overview

| Phase | Name | Retires / adds | Blast radius | Reversible |
|-------|------|----------------|--------------|-----------|
| **0** | Guardrails & the ADR decision | adds lint gates, CODEOWNERS, pilot DLQ; amends ADR-001 | none (no runtime change) | trivially |
| **1** | Establish `shared/` kernel | relocates core/routes/contracts; defines ports | low (moves + barrels) | trivially |
| **2** | `PlatformRouter` + one switch | adds `resolvePlatformTarget()`; retires the 2-switch split | medium (mount path) | flag |
| **3** | `NativeShell` = sole chrome owner | collapses 7 safe-area + 3 scroll owners; adds status-bar/keyboard | **high** (scroll root) | per-shell |
| **4** | Retire `Layout` + land `WebShell` | deletes `Layout` (1548 LOC), `AppShell` mobile/native branches, dual trees | medium-high | per-page |
| **5** | `MobileRouter` (native semantics) | adds native stack; retires global `<Switch>` subtree-swap | medium | flag |
| **6** | Backend/tenancy/worker hardening | RLS backstop, D3 fixes, DLQ, 64-bit locks, Zustand call | low-medium (RLS = medium) | shadow→enforce |
| **7** | Ionic decommission / Expo on-ramp | deletes `@ionic/*`; begins RN port of `native/` only | high (Expo) | gated |

---

## 2. Phases in detail

Each phase: **Goal · Moves · Exit criteria · Maps to · Blast radius.**

### Phase 0 — Guardrails & the ADR decision  *(no behavior change)*
- **Goal:** make the target enforceable and resolve the strategic fork before anyone writes shell code.
- **Moves:**
  - Amend **ADR-001** to record the §2 decision: *Expo north star; Ionic frozen & decommission-gated; Capacitor retained as the bridge.* Add the compliance gate the original ADR lacked (F-2: *“no compliance gate failed when `IonRouterOutlet`/`IonTabBar` never appeared”*).
  - Add the **`clinicId` co-presence AST/lint** rule (I1) and wire it into CI.
  - Add the **`shared/` boundary lint** (rejects DOM/Ionic/Capacitor/Express/Drizzle/wouter/Dexie imports from the kernel).
  - Add **CODEOWNERS** for the six domains (§3).
  - Add a **pilot-queue DLQ + failure alarm** (E3/I3) — independent, low-risk, builds momentum.
- **Exit:** CI runs the two new lint gates (initially `warn`/allowlisted); ADR-001 merged; pilot DLQ live.
- **Maps to:** F-2, I1, E3. **Blast radius:** none.

### Phase 1 — Establish the `shared/` kernel
- **Goal:** stand up the Expo seam as a real, lint-enforced boundary.
- **Moves:** relocate `src/core/*`, `src/lib/routes/*` (the route table), top-level `shared/*.ts`, `src/types/*`, and `lib/i18n` into `shared/`. Define the **ports** (`NfcPort`, `HapticsPort`, `DeepLinkPort`, `StatusBarPort`, `KeyboardPort`, `CachePort`, `SyncQueuePort`, `ApiClientPort`, `AuthSessionPort`). Pure moves + barrel exports + import-path updates — **no logic change**.
- **Exit:** `shared/` boundary lint flips from `warn` to **`error`**; `tsc` green; existing tests green. `shared/` imports nothing but TS.
- **Maps to:** F-6. **Blast radius:** low (mechanical).

### Phase 2 — `PlatformRouter` + the single switch
- **Goal:** one decision about which shell mounts; kill root-cause #3 and F-5.
- **Moves:** introduce `resolvePlatformTarget(): "mobile" | "desktop" | "marketing"` in `shared/`. Replace `App.tsx:40-46`’s `useIsMobile()` fork and `AppShell.tsx:42`’s `useIsDesktop()` branch with one `<PlatformRouter>` under `<Providers>`. Behind a feature flag; **mobile-web now resolves to `mobile`** (the F-5 fix), so verify the installed PWA + mobile Safari render the mobile path.
- **Exit:** one switch in the tree; flag default-on after browser + WKWebView + PWA verification; `tests/mobile-shell.test.tsx` updated in lockstep.
- **Maps to:** F-1, F-5, root-cause #3. **Blast radius:** medium (every authenticated mount).

### Phase 3 — `NativeShell` becomes the sole chrome owner  *(highest-risk phase)*
- **Goal:** collapse the ownership matrix on the touch side.
- **Moves:**
  - Build `StatusBar`, `NativeHeader`, `NativeScreen`, `NativeTabBar`. `NativeScreen` becomes **the one scroll container + the one safe-area edge + keyboard avoidance**.
  - **Delete** the competing owners: `body`/`.app-shell` global insets (`index.css:386-390,771-779`), per-screen `env(safe-area-*)` (~20 sites incl. `TodayScreen.tsx:70`, `EquipmentListScreen.tsx:52`, …), `Layout`’s bottom nav, the `MobileShell.tsx:20` top pad duplication.
  - Add `@capacitor/status-bar` + `@capacitor/keyboard`, wired **only** in `NativeShell` behind `StatusBarPort`/`KeyboardPort` (so mobile-web gets the PWA fallback).
- **Exit:** exactly one scroll root and one inset application on touch; `env(safe-area-*)` count → near-zero (lint-asserted); verified in WKWebView (status bar + keyboard) and PWA.
- **Maps to:** ownership matrix (safe areas 7→1, scroll 3→1, header 3→1, keyboard 0→1, status bar 0→1). **Blast radius:** **high** — scroll-root changes have a documented sticky-header regression history (`index.css:379-383`). **Migrate one shell at a time; never `tsc`-only.**

### Phase 4 — Retire `Layout`; land `WebShell`; collapse dual trees
- **Goal:** one shell per target; stop desktop markup leaking onto native.
- **Moves:**
  - Route mobile-web through `NativeShell` (done in P2/P3), then **delete `Layout` (1548 LOC)**.
  - Rename `AppShell` → `WebShell`/`DesktopShell`; **delete** its `insideMobileShell` pass-through (`AppShell.tsx:44`) and its `Layout` branch (`:56-67`). Only the `PageShell` path survives (Q3).
  - **Collapse dual trees (F-3):** for each of the 5 forked pages (`home.tsx:64-66`, `equipment-list.tsx:123`, …) pick the canonical implementation and **delete the other deliberately, with review** — this changes behavior, it is not a refactor.
  - This removes F-4 (22/27 pages leaking desktop JSX into the native shell): un-migrated pages now mount in `WebShell` (desktop) or get a real native screen, never raw inside `NativeShell`.
- **Exit:** `Layout` gone; `AppShell` is a single-purpose desktop frame; no page renders two trees; no desktop max-width/hover markup appears on touch.
- **Maps to:** F-3, F-4, Q3. **Blast radius:** medium-high (per-page behavior change — review each).

### Phase 5 — `MobileRouter` — native navigation semantics
- **Goal:** deliver the ADR’s promised native nav without Ionic.
- **Moves:** give `NativeShell` its own outlet over the shared route table — native stack history, push/pop, swipe-back, per-tab back stacks (`ADR-001:53`). Use an **Expo-portable** stack router (G4), **not** `IonRouterOutlet` (dead-end for Expo, §2). Decommission the global subtree-swapping `wouter <Switch>` (`routes.tsx:85-181`); desktop/marketing keep wouter outlets.
- **Exit:** native push/pop + swipe-back verified in WKWebView; the route **table** remains the only SSoT; wouter no longer swaps native subtrees.
- **Maps to:** Q5, “navigation: 1 router / 0 native semantics.” **Blast radius:** medium (navigation everywhere on touch).

### Phase 6 — Backend / tenancy / worker / state hardening
- **Goal:** add the security audit’s prioritized backstops without disturbing the Strong rating.
- **Moves:**
  - **Tenancy RLS backstop (C1/I1):** add `set_config('app.current_clinic_id', …, true)` in the tenant transaction + `CREATE POLICY` on every `vt_` table. Roll out **`shadow` → `enforce`** (R-T). Grant worker/system contexts an explicit clinic GUC or bypass role **before** enforce.
  - **D3 fix:** explicit `eq(table.clinicId, clinicId)` on procurement `UPDATE`s + `containerItems` lookup/insert.
  - **Workers:** 64-bit `hashtextextended` advisory locks (I4); reconsider `charge-alert attempts:1` (E3).
  - **State hygiene (F2):** remove `zustand` (or formally adopt it as the single store — `TARGET_ARCHITECTURE.md` §5.9).
  - Treat `STABILITY_TOKEN` / `ADMIN_EMAILS` as audited production secrets (A3/A4).
- **Exit:** RLS in `enforce` for all tenants with no false denials in shadow logs; D3 statements clinic-scoped; pilot DLQ + 64-bit locks live; Zustand resolved; `tests/cross-tenant-denial.test.ts` + structural lock still green.
- **Maps to:** C1, D3, E3, I1, I4, F2, A3, A4. **Blast radius:** low-medium (**RLS = medium** — see R-T).

### Phase 7 — Ionic decommission / Expo on-ramp  *(gated)*
- **Goal:** collect the convergence dividend.
- **Moves:**
  - **G1:** with nothing depending on Ionic but `IonApp`, delete `@ionic/react` + `@ionic/core`, remove `IonApp`/`setupIonicReact()` (`main.tsx:4,9`), amend ADR-001 → Option B. One commit; verify no screen relied on Ionic CSS variables.
  - **Expo port (when triggers fire — §6):** re-implement **only `native/`** in RN, reusing `shared/` + `offline/` ports + `backend/` + `workers/` unchanged. Swap `offline/` storage adapter (Dexie → SQLite). Decide G2 (mobile-web via `react-native-web` over the same source, or a retained DOM `NativeShell`).
- **Exit:** `@ionic/*` absent from `package.json`; (if triggered) RN app boots against the same backend with `shared/` unchanged.
- **Maps to:** F-2, audit §7 Expo notes, G1/G2. **Blast radius:** high (Expo) — **trigger-gated, not scheduled.**

---

## 3. Ownership model

### 3.1 Domain ownership (CODEOWNERS, added in Phase 0)

| Domain | Charter | Must not |
|--------|---------|----------|
| `shared/` | the kernel: entities, use-cases, ports, route table, contracts, i18n | import any framework; hold secrets or the auth resolver |
| `native/` | touch shell + screens + Capacitor adapters | own business rules; duplicate the route table; leak into `desktop/` |
| `desktop/` | web shell + pages + marketing | render mobile chrome; define its own nav |
| `offline/` | Dexie, sync-engine, SW, emergency-block, realtime client | weaken frozen surfaces; queue emergency mutations |
| `backend/` | Express API, auth, authority, tenancy, schema | read role from JWT; trust a client `clinicId`; skip a `clinicId` predicate |
| `workers/` | BullMQ workers/schedulers, outbox publisher | double-deduct; drop a job without DLQ; retire Strategy-A |

### 3.2 Concern ownership (the P1 contract)

Each concern has **exactly one** owner (`TARGET_ARCHITECTURE.md` §5.4). The enforcement rule:

> **A screen/page/route is a consumer, never an owner.** Touching `env(safe-area-inset-*)`, `100dvh`, `matchMedia`, document scroll, or drawing a tab bar in a screen is a contract violation (lint target). Insets/scroll/chrome are applied **once**, at the shell edge.

### 3.3 Dependency-direction rule (lint-enforced)

Allowed imports only: `shared/`→∅; `backend/`→`shared/`; `workers/`→`shared/`,`backend/`; `offline/`→`shared/`; `native/`→`shared/`,`offline/`; `desktop/`→`shared/`,`offline/`. **No shell imports another shell.** Violations fail CI (extends the existing `.dependency-cruiser.cjs`).

---

## 4. Dependency graph (target) + enforcement

```
                         ┌──────────────┐
                         │   shared/    │   imports NOTHING (kernel / SSoT)
                         └──────▲───────┘
        ┌───────────────┬───────┼─────────┬────────────────┐
   ┌────┴────┐    ┌─────┴───┐   │    ┌────┴─────┐    ┌──────┴─────┐
   │ native/ │    │desktop/ │   │    │ offline/ │    │  backend/  │
   └────┬────┘    └────┬────┘   │    └────▲─────┘    └──────▲─────┘
        └──────────────┴────────┼─────────┘          ┌──────┴─────┐
        client shells → shared/ + offline/           │  workers/  │  → shared/ + backend/
                                                      └────────────┘
```

- **Acyclic**; `shared/` is the universal sink; presentation domains are leaves.
- **Enforced by** `.dependency-cruiser.cjs` rules + the `shared/` boundary lint (Phase 0/1).
- **Expo swap surface:** only `native/` (DOM→RN) + `offline/` adapters change; everything else is invariant.

---

## 5. Risk register

Severity uses the audits’ scale (🔴 high / 🟠 medium / 🟢 low).

| ID | Risk | Severity | Source | Mitigation |
|----|------|----------|--------|-----------|
| **R-1** | **Scroll-root change** silently breaks scroll-restoration, momentum, `position: sticky` (documented prior regression) | 🔴 | `NATIVE_ARCHITECTURE.md` §7; `index.css:379-383` | Phase 3 one shell at a time; browser + WKWebView verification; keep the sticky-header drill green |
| **R-2** | **Frozen surfaces disturbed** — removing the SW or touching SSE/build-tag/emergency denylist breaks PWA offline + Code-Blue cache bypass | 🔴 | `CLAUDE.md`; audit §7 | Shell refactors leave `public/sw.js`, SW registration (`main.tsx:115`), and emergency caching untouched; CI asserts denylist |
| **R-3** | **Code Blue is online-only / server-confirmed** — a router or shell change introduces optimistic local termination or offline queueing | 🟠 | audit §7; `offline-emergency-block.ts` | Phases 3/5 preserve the classifier; no optimistic emergency state; reconnect = replay + reconciliation |
| **R-4** | **Dual-tree deletion changes behavior** — picking the wrong canonical screen drops a feature | 🟠 | F-3 | Phase 4 per-page review; treat as behavior change, not refactor; screenshot diff |
| **R-5** | **Shell-aware tests** drift — `mobile-shell.test.tsx` asserts current behavior | 🟠 | audit §7 | Update tests in lockstep each phase; never disable to “go green” |
| **R-T** | **RLS rollout over-blocks** — a policy denies legitimate worker/system or cross-clinic admin queries (workers run **without a user**) | 🟠 | C1; E-series (workers) | Phase 6 `shadow`→`enforce` like the authority envelope; grant system contexts an explicit `app.current_clinic_id`/bypass role before enforce; load-test |
| **R-6** | **Ionic removal regresses CSS** — a screen secretly depends on Ionic platform CSS variables | 🟠 | F-2 | Phase 7 G1: grep for Ionic CSS-var usage first; visual-diff before/after delete |
| **R-7** | **Mobile-web has no Capacitor** — status-bar/keyboard plugins are native-only, but mobile-web now enters `NativeShell` | 🟠 | F-5 | Ports (`StatusBarPort`/`KeyboardPort`) ship a PWA fallback (theme-color / `visualViewport`); both runtimes verified in Phase 3 |
| **R-8** | **Expo liabilities accrue** if new screens keep reaching for `env()`/`100dvh`/`matchMedia`/Radix/`framer-motion`/wouter | 🟠 | audit §7 | Concern-ownership lint (§3.2) confines these to shells; route **table** (not trees) keeps the Expo-Router swap mechanical |
| **R-9** | **Big-bang temptation** — doing the reorg as one PR | 🔴 | §4.1 root cause | Phases are independently shippable & reversible; **retire-as-you-go**, never add a third owner |
| **R-L** | **Low-risk, do-first** — `@capacitor/keyboard`/`status-bar` add, `AppShell`→`WebShell` rename, AST lint, CODEOWNERS, pilot DLQ | 🟢 | audit §7 | Land in Phase 0/early to build momentum and safety net |

---

## 6. Expo / React-Native migration compatibility

### 6.1 Keep / replace ledger

| Asset | Disposition | Mechanism / note |
|-------|-------------|------------------|
| `shared/` (entities, use-cases, ports, **route table**, contracts, i18n) | **Keep 100%** | framework-free already (F-6); the whole strategy |
| `backend/` + `workers/` | **Keep 100%** | server-side; Expo is a client migration |
| React Query (server state) | **Keep** | RN-supported, unchanged |
| `offline/` sync-engine + emergency-block + realtime client | **Keep contracts** | swap storage **adapter** only |
| `offline/` storage (Dexie/IndexedDB) | **Replace adapter** | `CachePort`/`SyncQueuePort` → SQLite (op-sqlite) / MMKV |
| Capacitor plugins (NFC/haptics/deep-link/camera) | **Re-bind** behind same ports | Expo modules / config plugins over the same native code; `ios/`+`android/` continue |
| `native/` shell + screens (DOM `<div>`s, Tailwind) | **Re-implement in RN** | the only large throwaway; minimized by concern-ownership |
| Routing (`wouter`, global `<Switch>`) | **Replace** outlet, keep table | `MobileRouter` abstraction → Expo Router; wouter stays desktop-only or retires |
| `desktop/` + `MarketingShell` | **Stay web** | unaffected by RN |
| `@ionic/react`, `@ionic/core` | **Delete** (G1) | dead end for Expo; quarantined at `IonApp` |
| Radix portals, `framer-motion`, `react-helmet-async` | **Replace** in `native/` only | RN equivalents; confined to shells so the surface is small |

### 6.2 Why the order works for Expo

Phases 1–5 **shrink the throwaway**: every `env()`/scroll/nav concern pulled out of a screen and into a shell is one fewer thing the RN port must redo (audit §7: *“The fewer screens that touch chrome, the smaller the eventual RN port”*). Centralizing on a route **table** (Phase 1/5) makes the Expo-Router swap *“mechanical instead of a rewrite”* (audit §7 router lock-in). By Phase 7, the Expo port is: re-skin `native/` in RN, swap two `offline/` adapters, delete Ionic — with `shared/`, `backend/`, `workers/` untouched.

### 6.3 Trigger table (when to actually start Phase 7’s RN port)

Inherited from ADR-001’s Option-A re-evaluation triggers; the migration **begins** when any fires (until then, Phases 0–6 stand on their own merit):

- A second mobile engineer is hired, **or**
- Three distinct users cite navigation feel as friction, **or**
- An iOS-release Ionic/WebView regression stays unresolved > 60 days, **or**
- A required capability (e.g. richer background sync, App Clip depth) is blocked by the WebView.

Until a trigger fires, **stop at Phase 6**: the app is already converged, single-owner, hardened, and Expo-ready — without paying for the RN rewrite.

---

## 7. Verification & exit gates (every phase)

1. `npx tsc --noEmit` — zero errors.
2. `pnpm test` (vitest) — counter contracts + tenancy/authority regression locks green (`cross-tenant-denial.test.ts`, `authority-*`, `mobile-shell.test.tsx`).
3. **Browser + WKWebView + installed-PWA** smoke for any scroll/safe-area/nav/status-bar/keyboard change (audit §7 — not optional).
4. Frozen-surface assertions pass: SSE replay, build-tag cache name, emergency denylist, offline-emergency-block.
5. Phase-9 Playwright drills (`tests/phase-9-drills.spec.ts`) green for Phase-9-adjacent work.
6. The phase **deleted** its competing owner (retire-as-you-go) — a phase that only *adds* is incomplete.

---

### One-line plan

> **Converge first (Phases 0–5): one kernel, one switch, one shell per target, one owner per concern — deleting a competitor at every step. Harden the already-Strong backend (Phase 6). Then, and only on trigger, collect the dividend: delete Ionic and port the single `native/` leaf to Expo (Phase 7) — backend, workers, kernel, and sync untouched.**
