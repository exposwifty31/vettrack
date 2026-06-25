# ADR-001: Adopt Capacitor + Ionic React for Mobile Shell

| Field | Value |
|-------|--------|
| **Date** | 2026-06-25 |
| **Status** | accepted |
| **Tags** | `#frontend-state` |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

VetTrack is a veterinary hospital operations platform with an existing React + Vite frontend served as a PWA. The product requires a native iOS and Android presence for:

- NFC tag scanning (equipment check-in/out)
- Haptic feedback on clinical actions
- Push notifications for alerts and shift handoffs
- App Store / Play Store distribution
- Background sync while the app is backgrounded on mobile

The team has already shipped a Capacitor-wrapped iOS and Android build (`ios/`, `android/`) using the existing React codebase. The question this ADR addresses is: **which framework should own the mobile shell layer for the upcoming Mobile Evolution plan?**

Three options were evaluated:

**Option A — React Native (RN):** Full migration. Best-in-class navigation feel, largest hiring pool. Cost estimate: 4+ months of engineering time to port all screens. Re-evaluate when a second mobile engineer is hired or when three distinct users cite navigation as friction.

**Option B — Capacitor + native web views (status quo):** The app runs in WKWebView. NFC and haptics are custom Capacitor Swift plugins already shipping. No framework migration needed. Navigation feel is limited to CSS transitions. Maintenance risk if Ionic is not adopted.

**Option C — Capacitor + Ionic React (this decision):** Extends the existing Capacitor shell with Ionic's `IonRouterOutlet`, `IonTabBar`, `IonModal`, `IonSegment`, and native gesture recognizers (`UIScreenEdgePanGestureRecognizer` for swipe-back). Preserves the existing desktop Wouter routing path. Estimated cost: 6–8 sprint sprints. Migration trigger conditions documented in the execution plan.

## Decision

Adopt **Option C**. Add `@ionic/react` + `@ionic/core` to the project. Wire `IonApp` at the React root. Build the mobile shell (`src/shell/mobile/`) using Ionic components on top of the existing Capacitor layer. Desktop routing remains on Wouter — `MobileShell` vs `AppShell` is gated by a `useIsMobile()` hook in `App.tsx`.

Architecture layer contract established alongside this decision:

```
Shell (src/shell/)
  ↓ imports
Features (src/features/[name]/)
  ↓ imports
Application (src/hooks/ + TanStack Query + Zustand)
  ↓ imports
Core (src/core/)          ← pure TS, zero framework deps
  ↑ implemented by
Infrastructure (src/infrastructure/)
```

## Consequences

**Positive:**
- Existing 44+ API routes, DB schema, realtime transport, auth, and offline sync engine are untouched.
- Native iOS push/pop transitions, swipe-back gestures, and half-sheet modals available without a full RN migration.
- iOS App Clip, Siri Shortcuts, and background sync can still be delivered as custom Swift Capacitor plugins.
- The desktop path remains unchanged — zero regression risk for clinic admin users.
- Migration to RN remains on the table if trigger conditions are hit (see execution plan trigger table).

**Negative:**
- Ionic's CSS animation layer sits between Capacitor and native UIKit transitions. Any iOS-release Ionic regression unresolved >60 days is a trigger to re-evaluate.
- `IonRouterOutlet` and `IonTabBar` need to coexist with the existing Wouter router — this requires careful gating in `App.tsx` and is a source of potential routing conflicts.
- The project now carries two UI frameworks (shadcn/Tailwind for desktop, Ionic for mobile shell). Component overlap must be managed: Ionic components are mobile-shell-only; shadcn components serve both layers.

## Compliance

- [x] `npx tsc --noEmit` — zero errors required
- [ ] `pnpm test` — existing test suite must pass
- [ ] Manual smoke test on iOS Simulator (Capacitor build)
- [ ] Verify desktop routing unchanged (Wouter `Switch` still active on `isDesktop` path)
