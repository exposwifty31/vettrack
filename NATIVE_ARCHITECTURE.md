# NATIVE_ARCHITECTURE.md

> Forensic audit of VetTrack's transition from a web-first React SPA to a
> native-first Capacitor application.
>
> **Scope:** architecture, ownership, and native-readiness only. This document
> does **not** patch CSS, fix screens, or optimize responsive layouts — it
> diagnoses *who owns what* and *why the app still feels like the web*.
>
> **Method:** every claim below is anchored to a `file:line` so it can be
> verified, not taken on faith.
>
> **Date:** 2026-06-26 · **Branch:** `claude/sweet-sagan-yse1o0`

---

## 0. Executive verdict

VetTrack is **not** a native-first application. It is a **web-first PWA wrapped
in Capacitor, with a thin Ionic veneer (`IonApp` only) and a partially-built
parallel "native shell" grafted on top.** Three UI paradigms ship in one
bundle and are active simultaneously. The same screens are implemented two or
three times, and every cross-cutting native concern (safe areas, scrolling,
navigation, headers) has **two to seven competing owners**.

The single most consequential finding: **ADR-001 commits the team to "Option C
— Capacitor + Ionic React" using `IonRouterOutlet`, `IonTabBar`, `IonModal`,
`IonSegment`, and native gesture recognizers** (`docs/architecture/adr/ADR-001-capacitor-ionic.md:29`).
**None of those primitives exist in the codebase.** The project pays Ionic's
full cost (an extra framework, `IonApp` interposed at the root) and receives
**none** of its native benefit. The "native shell" (`src/shell/mobile/`) is
hand-rolled `<div>`s with inline styles — functionally identical to the PWA it
was meant to replace.

| Hypothesis | Verdict |
|---|---|
| **#1 — Web + Native + Capacitor are simultaneously active** | ✅ **Confirmed.** One Vite bundle (`dist/public`) serves marketing web, installed PWA, *and* the Capacitor native build. All three runtime paradigms coexist at root. |
| **#2 — Duplicated ownership / desktop leakage / native violations** | ✅ **Confirmed, severe.** No concern has a single owner. Safe areas have 7 owners; scrolling has 3 models; navigation chrome has 2 parallel implementations; 22 of 27 pages leak desktop web markup into the native shell. |

---

## 1. The architecture as built (vs. as drawn)

The chain in the task brief is accurate but hides the branching. Here is what
actually executes:

```
main.tsx
  setupIonicReact()                         ← Ionic initialized…
  <IonApp>                                  ← …but this is the ONLY Ionic component used
    <HelmetProvider>                        ← react-helmet-async (web SEO)
      <ClerkProvider> (web | native instance)
        <QueryClientProvider> … <SyncProvider>
          <AppBootstrap>                    ← forks: SW register (web) | deep-link+NFC (native)
            <App>
              useIsMobile()  ===  isCapacitorNative()   ← the ONE native/web switch
              │
              ├── TRUE  (Capacitor only) ──► <MobileShell>   (hand-rolled divs)
              │                                 └── <AppRoutes/> (wouter)
              │                                       └── Page
              │                                             ├── inMobileShell? <XScreen/>   (native variant — 5 pages)
              │                                             └── else <AppShell> → returns children only
              │
              └── FALSE (web + PWA) ───────► <AppRoutes/> (wouter)
                                                  └── Page
                                                        └── <AppShell>
                                                              ├── isDesktop(≥1024)? <PageShell>  (Topbar + Sidebar)
                                                              └── else            <Layout>     (sticky header + bottom nav, 1548 LOC)
```

**Routing is `wouter` end-to-end** (`src/app/routes.tsx:1`) — a web SPA router.
There is **no** `IonReactRouter`, `IonRouterOutlet`, `IonNav`, or `IonPage`
anywhere. Navigation is `<Switch>`/`<Route>` swapping React subtrees in place,
with no native stack, no push/pop transition, and no swipe-back gesture.

### Evidence that Ionic is decorative

```
$ grep -r "from '@ionic/react'" src
src/main.tsx:4: import { IonApp, setupIonicReact } from "@ionic/react";   ← the only import
```

`Ion{RouterOutlet,Page,Content,Tabs,TabBar,Header,Toolbar,Modal,Segment,…}`:
**0 occurrences in `src/`.** `IonApp` provides Ionic's platform-mode CSS class
and CSS variables on `<html>`, nothing more. The app then ignores Ionic's
scroll container (`IonContent`), its safe-area machinery (`IonHeader`/`IonToolbar`),
and its navigation stack — and reimplements all of them by hand.

---

## 2. Ownership matrix

Every concern is listed with **all** of its current owners (the bug) and the
**single** owner it should have (the fix). "Owners" counts independent code
locations that set the property — not call sites of a shared helper.

| Concern | Current owners (count) | Evidence | Conflict | Should be owned by |
|---|---|---|---|---|
| **Safe areas** | **7+** | `body` global pad `index.css:386-390`; `.app-shell` global pad `index.css:771-779`; `MobileShell` top `MobileShell.tsx:20`; `MobileTabBar` bottom `MobileTabBar.tsx:88`; `Layout` header bleed `index.css:553-556` + main `layout.tsx:1341` + bottom nav `layout.tsx:1352`; **every** native screen re-adds bottom inset (`TodayScreen.tsx:70`, `EquipmentListScreen.tsx:52`, `AlertsScreen.tsx:49`, `ScanScreen.tsx:26`, `EquipmentDetailScreen.tsx:74`); ~8 one-off components (`qr-scanner`, `crash-cart-admin-sheet`, `pwa-install-prompt`, `inventory-page`, `equipment-list` FAB, `TransferSheet`, `AccountabilityConfirm`, `MoreSheet`) | `body` pads the top inset for *all* screens, then `MobileShell` pads it **again**; `Layout`'s header uses negative-margin "bleed" (`header-safe-bleed`) specifically to **undo** the body padding it didn't want. The system fights itself. | **One** shell component per platform target. Insets applied **once**, at the shell edge. Screens never touch `env(safe-area-inset-*)`. |
| **Headers** | **3 (mutually exclusive, none shared)** | Desktop `Topbar` (`PageShell.tsx:23`); web-mobile sticky header (`layout.tsx` `<header>` ~`:1010`); native = **no header at all** (`MobileShell` renders only a tab bar). Native pages each draw their own "large title" (`EquipmentLargeTitle`, `ShiftHero`). | A native user gets no app-level header/back affordance; each migrated screen reinvents a title bar; un-migrated pages render their desktop `<header>` markup raw inside the native shell. | One header contract owned by the active shell, with a native back/title region. |
| **Tab bar / bottom nav** | **2 full parallel implementations** | `MobileTabBar` (`src/shell/mobile/MobileTabBar.tsx`, Capacitor only) **vs.** `Layout` bottom nav (`layout.tsx:1348-1346`, web-mobile only). Different items, different markup, different scan-FAB. | The **same phone** shows a *different* navigation bar depending on whether it runs the App Store build (`MobileTabBar`) or the installed PWA / mobile Safari (`Layout` bottom nav). | One tab bar, one nav model (`src/lib/routes/nav-model`), rendered by the shell. |
| **Scrolling** | **3 different scroll roots** | Native: inner `<div style="overflow:hidden auto">` inside `MobileShell.tsx:24-30`. Desktop: `<section class="overflow-y-auto overscroll-contain">` in `PageShell.tsx:26`. Web-mobile: the **document/viewport** scrolls (`layout.tsx` main is `min-h-[100dvh…]`, header `sticky`, nav `fixed`) — `index.css:379-383` deliberately keeps the viewport as the sticky scroll root. | Three scroll models means three sets of momentum/overscroll/scroll-restoration bugs. Native screens assume `minHeight:100%` against MobileShell's div; web-mobile assumes the viewport scrolls. A migration that changes the root breaks one of them silently. | One scroll container owned by the shell content region. Native: `IonContent` (or one shell scroller). Screens are scroll-agnostic. |
| **Viewport** | **1 (web), delegated on native** | `index.html:161` `viewport-fit=cover`; Capacitor `contentInset:"never"` (`capacitor.config.ts:22-28`) explicitly hands viewport ownership to the web layer ("the web layer owns safe areas… same rendering as the installed PWA"). | Intentional, but it locks native rendering to PWA semantics — native gets **no** native viewport/inset management, which is *why* §safe-areas needs CSS hacks. | Acceptable short-term; revisit if/when a native shell (`IonContent`/RN `SafeAreaView`) takes over insets. |
| **Keyboard** | **0 global owners; 1 ad-hoc** | No `@capacitor/keyboard` plugin installed (confirmed absent from `package.json`). Only `ShiftChatPanel.tsx:67-79` manually reads `window.visualViewport` to pad itself. | On iOS WKWebView with `contentInset:"never"`, the soft keyboard covers inputs everywhere **except** shift-chat. Forms (`new-equipment`, sign-in, search) have no keyboard avoidance. | One keyboard owner — `@capacitor/keyboard` (native) wired into the shell, or `IonContent`'s built-in handling. |
| **Status bar** | **0 native owners** | No `@capacitor/status-bar` plugin. Style set only via PWA meta `apple-mobile-web-app-status-bar-style` (`index.html:231`), which does **not** govern the Capacitor WKWebView. | Status bar text color/overlay is unmanaged on native; can render invisible against dark/light screens. | `@capacitor/status-bar`, set once at boot per theme. |
| **Navigation** | **1 router, 0 native semantics** | `wouter` `<Switch>` (`routes.tsx:85-181`); navigation via `useLocation()`/`navigate()` (`MobileTabBar.tsx:71`). | In-place subtree swap — no native push/pop, no gesture back, no per-tab history stack. The ADR's promised "native iOS push/pop transitions, swipe-back" (`ADR-001:53`) are not delivered. | A native-aware router (`IonReactRouter`+`IonRouterOutlet`, or Expo Router post-migration). |
| **Layout containers** | **4 overlapping** | `MobileShell` (native), `AppShell` (dispatcher, `AppShell.tsx`), `PageShell` (desktop), `Layout` (web-mobile, 1548 LOC). Plus `.app-shell` CSS class (`index.css:771`). | `AppShell` exists only to *re-decide* mobile-vs-desktop that `App.tsx` already decided once via `useIsMobile()`. Two layers make the same branch on different signals (`isCapacitorNative` vs `matchMedia(1024px)`). | One shell per target; `AppShell`'s dispatch role collapses into the shell layer. |

---

## 3. Architectural findings

### F-1 — Three runtimes, one bundle (Hypothesis #1 confirmed)
The Capacitor native app bundles the **identical** web build:
`capacitor.config.ts:14` → `webDir: "dist/public"`, produced by `vite build`
(`package.json:18`). That same build is the public marketing site (routes
`/`, `/landing`, `/privacy`, `/terms` in `routes.tsx:91-97`) and the installed
PWA (service worker registered in `main.tsx:115`). `AppBootstrap` branches at
runtime: native → deep-link router + NFC priming (`main.tsx:91-98`); web →
service-worker registration (`main.tsx:100-168`). **Web app + native app +
Capacitor are not phases of a migration — they are three live targets of one
artifact, switched on `isCapacitorNative()`.**

### F-2 — Ionic adopted in name, not in substance (the ADR gap)
ADR-001 (status: **accepted**, `:6`) chose Option C and explicitly scoped
`IonRouterOutlet`, `IonTabBar`, `IonModal`, `IonSegment`, native gesture
recognizers (`:29`), and "Build the mobile shell (`src/shell/mobile/`) using
Ionic components" (`:33`). The shipped `src/shell/mobile/` uses **zero** Ionic
components — `MobileShell.tsx` is two `<div>`s with inline fl/overflow styles.
The ADR's own listed risk — "`IonRouterOutlet` and `IonTabBar` need to coexist
with the existing Wouter router… a source of potential routing conflicts"
(`:60`) — was "resolved" by never adopting them. **The decision record and the
code have diverged; the costs of Option C are paid, the benefits are not.**

### F-3 — Pages are implemented 2–3× (dual-tree duplication)
Five pages fork their entire render tree on `useMobileShellContext()`:

```
home.tsx:64-66          inMobileShell ? <TodayScreen/>            : <HomePageDesktop/>
equipment-list.tsx:123  inMobileShell ? <EquipmentListScreen/>    : <…Desktop/>
equipment-detail.tsx:139…
alerts.tsx:95…
scan.tsx:6…
```

So `home` exists as: (a) `TodayScreen` (native, `src/features/today/`), (b)
`HomePageDesktop` → `AppShell` → `PageShell` (desktop), (c) the same
`HomePageDesktop` → `AppShell` → `Layout` (web-mobile). **Three
implementations of one screen**, each with its own scroll/safe-area/markup. The
native screens even hand-roll behaviors Ionic provides for free — e.g.
`TodayScreen.tsx:34-57` reimplements pull-to-refresh that `IonRefresher` ships.

### F-4 — Desktop markup leaks into the native shell (22 of 27 pages)
Only the 5 pages above have a native variant. The remaining pages that use
`AppShell` (27 files import it) render their **desktop/web** JSX directly inside
`MobileShell` on native, because `AppShell.tsx:44` short-circuits to
`return <>{children}</>` when `insideMobileShell` is true. So `settings`,
`admin`, `inventory`, `analytics`, `procurement`, `rooms`, `code-blue`,
`audit-log`, etc. appear in the native app as **un-chromed web pages** floating
above `MobileTabBar` — desktop abstractions (max-width containers, hover
affordances, sidebar-oriented spacing) leaking straight into the native
surface. The two duplication patterns (F-3 and F-4) pull in **opposite**
directions: some screens are forked, most are not. There is no consistent rule.

### F-5 — The native/web switch is binary and excludes the PWA
`useIsMobile()` returns `isCapacitorNative()` and nothing else
(`use-is-mobile.ts:7-9`; its own comment admits "Sprint 1.2+ will extend this
to include mobile browser viewports" — it hasn't). Consequence: a phone running
the **installed PWA or mobile Safari** is `isMobile === false`, so it skips
`MobileShell` entirely and falls into `AppShell` → `Layout` (web-mobile, the
1548-line legacy shell). **The "native" experience only exists inside
Capacitor; every other mobile user gets the old web shell.** This is the
clearest proof that "native-first" has not happened.

### F-6 — A clean layered core exists and is under-used (the bright spot)
ADR-001 also established a layered contract (`:35-47`) and it is partially real:
`src/core/` is framework-free TypeScript (`core/entities/design-tokens.ts`,
`core/use-cases/offline-emergency-block.ts`, `core/ports/`), and
`src/infrastructure/` holds platform adapters behind interfaces
(`platform/NfcAdapter.ts`, `HapticsAdapter.ts`, `DeepLinkAdapter.ts`,
`db/EquipmentCacheAdapter.ts`). **This is exactly the seam an Expo/React-Native
migration needs** — pure logic and ports that don't import React DOM. It is
currently thin and bypassed by most screens, but it is the right foundation to
grow.

---

## 4. Root causes

1. **A migration was declared but executed as an addition.** Capacitor + Ionic
   were layered *on top of* the PWA instead of *replacing* it. Nothing was
   retired — the PWA service worker, `Layout`, `PageShell`, and the global
   `body`/`.app-shell` insets all remain (F-1, F-5).

2. **The ADR was not enforced.** Option C's primitives were scoped but never
   adopted; no compliance gate failed when `IonRouterOutlet`/`IonTabBar` never
   appeared (F-2). `IonApp` satisfied the letter of "wire Ionic at the root"
   while the spirit (native navigation/scroll/insets) was skipped.

3. **Two switches decide the same thing on different axes.** `App.tsx` branches
   on *platform* (`isCapacitorNative`); `AppShell` branches on *viewport*
   (`matchMedia(1024px)`). Neither subsumes the other, so a third state
   (mobile-web) falls through the cracks (F-5) and a fourth (native tablet) is
   undefined.

4. **No owner was ever designated for cross-cutting native chrome.** Safe-area
   and scroll handling were solved per-screen as each was built, so the count
   of owners grew monotonically (7 for safe areas) with no component empowered
   to be *the* owner (F-3, ownership matrix).

5. **"Responsive web" instincts were carried into native.** Screens reach for
   `env(safe-area-inset-*)`, `100dvh`, media queries, and document scroll —
   web tools — instead of delegating to a shell, because the shell never
   offered to own them.

---

## 5. Answers to the five questions

**Q1 — Is the architecture mixing web and native paradigms?**
**Yes, comprehensively.** `wouter` SPA routing + Radix/shadcn portals +
`framer-motion` + `react-helmet-async` + a PWA service worker (web) run
alongside Capacitor plugins + a deep-link router + a hand-rolled "native" shell,
all under a decorative `IonApp` (native veneer). Routing, scrolling, and insets
are all solved the web way; the native layer is plugins only (NFC, haptics,
camera). See F-1, F-2, ownership matrix.

**Q2 — Is `AppShell` causing the web feel?**
**It is a primary symptom, not the sole cause.** `AppShell` is a viewport-driven
dispatcher to two *web* shells (`PageShell` desktop, `Layout` web-mobile). On
native it degrades to a pass-through (`AppShell.tsx:44`), so it doesn't directly
render in Capacitor — but it forces every page to be authored as a web page
first, which is then leaked raw into the native shell (F-4). The "web feel" on
native comes from (a) that leaked web markup and (b) the absence of native
navigation/scroll because Ionic primitives were never adopted (F-2). Fixing
`AppShell` alone is necessary but not sufficient.

**Q3 — Should `AppShell` become desktop-only?**
**Yes.** Its only defensible job is the desktop `PageShell` (Topbar + Sidebar).
Recommend: rename to `DesktopShell`, delete its mobile/native branches, and
delete the `insideMobileShell` pass-through. The web-mobile `Layout` should be
retired in favor of the native shell once the PWA/Capacitor split is unified
(Q5). Net: `AppShell` shrinks from a 3-way dispatcher to a single-purpose
desktop frame.

**Q4 — Should `MobileShell` become the sole owner?**
**Yes — for all touch/native targets, after it is made real.** Today
`MobileShell` owns *some* chrome (top inset, scroll, tab bar) but shares safe
areas with `body`/`.app-shell` and doesn't own headers, keyboard, or status
bar. Make it the **single** owner of: safe areas (apply once, here), the scroll
container, header/title region, tab bar, keyboard avoidance, and status bar.
Then route **both** native *and* mobile-web into it (fix F-5 by widening
`useIsMobile()` to include touch/narrow viewports), so there is one mobile shell
instead of `MobileShell` ⊕ `Layout`. Screens stop touching insets entirely.

**Q5 — Should mobile routing become independent?**
**Yes, with a clear seam.** The mobile shell should own a native-aware router
(today the lowest-risk step is `IonReactRouter` + `IonRouterOutlet` *inside*
`MobileShell`, with `wouter` retained only for the desktop/marketing tree;
post-migration this becomes Expo Router). Independent mobile routing is what
unlocks native stack history, push/pop transitions, swipe-back, and per-tab
back stacks — the ADR's promised benefits (`ADR-001:53`) that the shared
`wouter` switch structurally cannot provide. Keep the route **table** as the
single source of truth (`src/lib/routes/nav-model`) and let each shell render it
with its own outlet.

---

## 6. Target architecture

**Principle: one owner per concern, one shell per target, screens are chrome-agnostic.**

```
main.tsx
  <IonApp>                         ← keep ONLY if §Q5 adopts IonRouterOutlet; else remove Ionic entirely
    <Providers/>                   ← Clerk, Query, Settings, Sync (unchanged)
      <RootRouter>                 ← chooses shell by target, ONCE
        ├── target = desktop ───► <DesktopShell>          (was AppShell→PageShell)
        │                            owns: topbar, sidebar, desktop scroll
        │                            └── <DesktopRoutes/> (wouter)
        │
        ├── target = marketing ─► <MarketingShell>        (landing/privacy/terms; no app chrome)
        │
        └── target = touch ─────► <MobileShell>  ◄── SOLE OWNER of native chrome
              owns: safe areas (once), scroll container, header/title,
                    tab bar, keyboard, status bar, navigation stack
              └── <MobileRouter> (IonRouterOutlet now → Expo Router later)
                    └── <Screen/>   ← pure content. NEVER reads env(safe-area-*),
                                       never sets a scroll root, never draws a tab bar.
```

**Single-owner assignments (the end state of the matrix):**

| Concern | Sole owner |
|---|---|
| Safe areas | `MobileShell` (touch) / `DesktopShell` (desktop). Remove `body` + `.app-shell` global insets; strip `env(safe-area-*)` from all screens. |
| Header / title | Shell header region (native back + title). |
| Tab bar | `MobileShell` → `MobileTabBar`. Delete `Layout`'s bottom nav. |
| Scrolling | One shell scroll container (`IonContent` or one shell scroller). Screens are `height:auto`. |
| Keyboard | `@capacitor/keyboard` wired in `MobileShell` (add the plugin). |
| Status bar | `@capacitor/status-bar` set once at boot (add the plugin). |
| Navigation | Mobile router owned by `MobileShell`; desktop/marketing on `wouter`; one shared route table. |
| Viewport | Shell-level; CSS `env()` confined to the shell. |

**Convergence steps (north star, each independently shippable):**
1. Collapse `body`/`.app-shell` global insets into the shells; delete per-screen `env(safe-area-*)`.
2. Make `useIsMobile()` viewport+platform aware so PWA/mobile-web enters `MobileShell` (kills the `Layout` fork, F-5).
3. Retire `Layout` (1548 LOC) once mobile-web routes through `MobileShell`.
4. Rename `AppShell` → `DesktopShell`, delete its mobile/native branches (Q3).
5. Adopt `IonRouterOutlet` inside `MobileShell` *or* formally amend ADR-001 to "Option B" and **remove `@ionic/*`** — do not keep paying for Ionic while unused (F-2).
6. Add `@capacitor/keyboard` + `@capacitor/status-bar`; give them their owners.
7. Grow `src/core` + `src/infrastructure` so screens depend on ports, not DOM — the Expo on-ramp (F-6).

---

## 7. Migration risks

**Expo / React-Native compatibility (the stated optimization target):**
- ✅ **Asset:** `src/core` (pure TS) and `src/infrastructure/*Adapter` (ports)
  port to RN unchanged — keep all new logic behind these seams (F-6).
- ⚠️ **Liability:** every screen that reads `env(safe-area-inset-*)`, `100dvh`,
  `matchMedia`, document scroll, Radix portals, or `framer-motion` is **not**
  portable. The fewer screens that touch chrome (target arch §6), the smaller
  the eventual RN port. Each per-screen inset (≈20 sites) is a future manual
  rewrite.
- ⚠️ **Router lock-in:** `wouter` has no RN equivalent. Centralizing on a route
  *table* now (not scattered `<Route>` trees) makes the Expo-Router swap
  mechanical instead of a rewrite.
- ⚠️ **Ionic is a dead end for Expo.** If RN is the real destination, adopting
  more Ionic (Q5 option A) is throwaway work. Decide ADR-001's true target
  *before* investing further in either Ionic or `Layout`.

**Execution risks for the convergence itself:**
- 🔴 **Scroll-root change is high-blast-radius.** Three scroll models (matrix
  §scrolling) means changing the root can silently break scroll restoration,
  momentum, and `position: sticky` (the `index.css:379-383` comment documents a
  prior sticky-header regression from exactly this). Migrate one shell at a
  time; verify in a real browser/WKWebView, not just `tsc`.
- 🔴 **Frozen surfaces must not be disturbed.** Per `CLAUDE.md`, the realtime
  SSE transport, BroadcastChannel envelope, **emergency-endpoint cache
  denylist**, and PWA build-tag are load-bearing. Removing the service worker
  (a tempting "native cleanup") would break PWA offline + the Code Blue cache
  bypass. **Shell refactors must leave `public/sw.js`, the SW registration
  (`main.tsx:115`), and emergency caching untouched.**
- 🟠 **Code Blue is online-only and server-confirmed.** Any navigation/router
  change must preserve the offline-emergency block
  (`src/core/use-cases/offline-emergency-block.ts`) and must not introduce
  optimistic local termination of emergency state.
- 🟠 **Dual-tree deletion changes behavior.** Removing a page's
  desktop-or-native fork (F-3) is not a refactor — pick the canonical
  implementation per screen and delete the other deliberately, with review.
- 🟠 **Test coverage is shell-aware.** `tests/mobile-shell.test.tsx` asserts
  current shell behavior; update it in lockstep so the safety net stays honest.
- 🟢 **Low risk:** adding `@capacitor/keyboard` / `@capacitor/status-bar` and
  renaming `AppShell`→`DesktopShell` are additive/mechanical and can land first
  to build momentum.

---

## 8. One-line summary

> VetTrack is a web PWA wearing a Capacitor jacket and an Ionic name-tag:
> three paradigms in one bundle, every native concern owned by committee, the
> ADR's native primitives never built, and the only truly "native" experience
> gated behind the App Store build while everyone else gets the old web shell.
> The fix is not more code — it is **assigning each concern exactly one owner**
> and **making one shell per target**, starting from the clean `core/` +
> `infrastructure/` seam that already exists.
