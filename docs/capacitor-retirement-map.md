# Capacitor retirement map — audit snapshot 2026-08-28

**What this is.** The deletion/pruning map for retiring the Capacitor mobile app once the React
Native app (the separate `VetTrack---RN-Migration-` repo) ships from both stores and is crowned
primary. Written the way the RN repo's behavioural-divergence register was written: the register
exists **before** the work is scheduled, so retirement PRs are cut from a reviewed map instead of
ad-hoc greps.

**What this is NOT.** Not a trigger. Nothing here executes until the owner declares the RN store
lanes shipping. Every retirement PR re-verifies its paths against its own tree — this file is a
dated audit snapshot (produced by a read-only source audit, 2026-08-28, at `96f9ecda3`), and paths
drift.

**Deliberately ungoverned** (not listed in `verify.config.json`): a point-in-time snapshot whose
paths are expected to drift; the retirement PRs themselves carry the verified claims.

---

## Bucket 1 — Capacitor infrastructure (delete when retired)

**Config & native shells**
- `capacitor.config.ts` — `appId: "uk.vettrack.app"`, `webDir: "dist/public"`
- `ios/` — 31 git-tracked files (the ~1,200 on disk include gitignored build/SPM caches). Includes
  the native plugin halves (`DynamicTypePlugin.swift`, `NfcLockPlugin.swift`), the Control Center
  widget extension (`ios/App/VetTrackControl/*`, 4 files), `ExportOptions-upload.plist`.
- `android/` — 55 git-tracked files (of ~2,500 on disk incl. gitignored `.gradle`/`build`).
  `MainActivity.java` + `build.gradle` carry `uk.vettrack.app`; `google-services.json`; launcher
  and splash resources.

**Dependencies — the 12-package `@capacitor*` family**
- deps (9): `@capacitor-community/apple-sign-in`, `@capacitor/app`, `@capacitor/browser`,
  `@capacitor/camera`, `@capacitor/core`, `@capacitor/filesystem`, `@capacitor/haptics`,
  `@capacitor/share`, `@capgo/capacitor-nfc`
- devDeps (3): `@capacitor/android`, `@capacitor/cli`, `@capacitor/ios`
- `@capacitor/camera` has **zero** TS import sites today (`knip.json` ignore-lists it) — vestigial
  even before retirement.

**Scripts** — 11 npm scripts (`cap:*` ×8, `resubmit`, `resubmit:release`, `verify:resubmission`) +
7 shell scripts (`scripts/build-native-shell.sh`, `scripts/install-ios-sim.sh`,
`scripts/patch-capacitor-apple-sign-in-spm.sh`, `scripts/lib/native-shell-env.sh`,
`scripts/resubmit.sh`, `scripts/verify-resubmission.sh`, `scripts/verify-resubmission-static.sh`).

**CI** — `.github/workflows/ios-resubmission-static.yml` (the only workflow of 6 touching the
native build).

**Whole-file native-only bridges in `src/` (~15 — outright delete, no web behavior):**
`src/lib/capacitor-runtime.ts` · `src/lib/native-oauth.ts` · `src/lib/native-apple-link.ts` ·
`src/lib/clerk-native-instance.ts` · `src/lib/native-clerk-session-token.ts` ·
`src/lib/clerk-capacitor-config.ts` · `src/lib/deep-link-router.ts` ·
`src/infrastructure/platform/DeepLinkAdapter.ts` · `src/lib/nfc-lock.ts` · `src/lib/haptics.ts` ·
`src/lib/dynamic-type.ts` · `src/lib/routes/native-nav-model.ts` ·
`src/components/native-social-buttons.tsx` · `src/features/settings/MoreSheet.tsx` — plus all of
`src/native/` (Bucket 2).

**Dual-purpose files (~29 — prune the `isCapacitorNative()` branch, file stays):** among them
`src/main.tsx`, `src/app/routes.tsx`, `src/app/platform/index.ts`,
`src/app/platform/guards/WebOnlyGuard.tsx`, `src/hooks/use-auth.tsx`, `src/lib/api.ts`,
`src/lib/i18n.ts`, `src/lib/app-version.ts`, `src/lib/scan-affordance.ts` (collapses to a
constant), `src/hooks/use-nfc-supported.ts`, `src/lib/nfc-platform.ts`,
`src/components/native-clerk-gate.tsx`, `src/lib/clerk-appearance.ts`,
`src/features/auth/components/AuthDoorChrome.tsx`,
`src/pages/{help,my-profile,settings,signin,signup}.tsx`.

**Comment-only mentions (~7):** nothing to change (`src/components/layout.tsx`,
`src/core/ports/index.ts`, …).

---

## Bucket 2 — the phone-mirror shell on web (15 files — this is the "PWA remnant" the goal names)

```
src/native/NativeHeader.tsx           src/native/NativeShell.tsx
src/native/NativeShellContext.ts      src/native/NativeTabBar.tsx
src/native/NativeTabSidebar.tsx       src/native/tablet/InventoryItemsMasterDetail.tsx
src/native/tablet/RoomsMasterDetail.tsx   src/native/tablet/SelectItemPlaceholder.tsx
src/native/tablet/TwoPaneLayout.tsx   src/native/tablet/useIsNativeTablet.ts
src/shell/mobile/MobileShell.tsx      src/shell/mobile/MobileShellContext.ts
src/lib/routes/native-nav-model.ts    src/features/settings/MoreSheet.tsx
src/components/native-social-buttons.tsx
```

Plus content trims (not file deletions):
- `public/manifest.json` — the phone-install fields: `display: "standalone"`,
  `display_override`, `orientation: "portrait"`, the 4 `shortcuts`.
- `index.html` — the `apple-mobile-web-app-*` metas + touch-icon/startup-image links.
- `src/app/platform/index.ts` — the narrow-touch-viewport arm (`isTouchNarrow()`, the `"mobile"`
  `PlatformTarget` branch) that routes phones into `NativeShell`. Retires WITH `src/native/`;
  afterwards the web resolves to management/board/marketing targets only — **which is the
  "web becomes a true management tool" moment in code.**

---

## Bucket 3 — store/release collateral of the Capacitor lane

`docs/release/` (7 tracked) · `docs/mobile/` (14 tracked; the ~90 QA screenshots on disk are
gitignored, not deletions) · `RESUBMISSION_RUNBOOK.md` ·
`.github/workflows/ios-resubmission-static.yml` · the resubmission scripts above. No fastlane
config exists (only vendored copies inside SPM build caches).

---

## Bucket 4 — KEEP (shared; deleting these breaks the end-state)

| Path | Why it stays |
|---|---|
| `server/**` | The server half of the two-repo end-state |
| `packages/contracts/` | Consumed by the RN repo's pinned vendoring (`@vettrack/contracts`) |
| `shared/` (root — **there is no `packages/shared`**) | Cross-cutting constants/types for `src/` + `server/`; `ANDROID_APP_PACKAGE = "uk.vettrack.app"` stays correct — RN ships the same id |
| `packages/rfid-controller/` | Server-side RFID signing core, client-agnostic |
| `src/board/*`, `board-pair.tsx`, `code-blue-display.tsx`, `crash-cart.tsx` | The TV/ward board — its own platform target |
| `src/desktop/management/*` + everything behind `ManagementWebGate`/`WebOnlyGuard` | The management console — the web's future |
| `server/lib/push-fcm.ts`, `push-apns.ts`, `push.ts` + push schema/types | Multi-platform push written for the RN app's native tokens |
| `server/lib/well-known-assetlinks.ts` | Android App Links for `uk.vettrack.app` — the RN app needs it |
| `src/hooks/use-push-notifications.tsx` | Web Push for the management console (the non-Capacitor path) |

---

## Bucket 5 — AMBIGUOUS (decide per-PR, never bulk-delete)

- **`public/sw.js`** — the caching/update mechanics serve DESKTOP and the `/board` kiosk
  (`src/board/useBoardAutoReload.ts` listens for `sw-update-available`; `sw-update-banner.tsx`
  mounts unconditionally). Keep the mechanics; retire only the phone-offline framing.
- **`server/index.ts` (CORS block), `server/lib/clerk-authorized-parties.ts`,
  `server/lib/realtime-collab/config.ts`** — files stay; the `capacitor://localhost` /
  `ionic://localhost` WebView-origin constants inside them retire once no WebView client exists.
  One test covers these — goes with them.
- **`src/lib/nfc-sticker-payload.ts` / `nfc-capgo-decode.ts`** — payload decode is pure ("no
  Capacitor, no DOM") and imported by `equipment-detail.tsx` on desktop; the management console
  may still display scanned-tag state after the native read/write path retires.
- **`src/native/tablet/*`** — the iPad master-detail layouts: decide port-vs-discard explicitly
  (the RN repo has its own tablet panes).

---

## Sequencing

1. **Trigger:** owner declares RN shipping from both stores (Phase 2 → in review → released).
2. Cut retirement PRs per bucket, each re-verifying its paths: (a) native shells + deps + scripts,
   (b) phone-mirror shell + platform-target arm, (c) release collateral, (d) WebView-origin
   constants. Expect a comparable test pass: **41 files under `tests/`** reference these surfaces.
3. The Bucket-2(b) PR is the "web becomes management-only" flip; pair it with a redirect for
   phone-viewport visitors (store link), not a broken page.
4. `capacitor.config.ts`'s `appId` and the assetlinks fingerprint chain stay owned by the RN
   lane's store identity (`uk.vettrack.app` continuity — see the G5 identity migration).

**Audit provenance:** read-only source audit, 2026-08-28, tree `96f9ecda3`. Two accuracy notes
from the audit itself: the on-disk file counts for `ios/`/`android/` are dominated by gitignored
build caches (tracked counts are the real deletion size), and `docs/mobile/qa-screenshots/` +
`artifacts/mobile/screenshots/` are gitignored capture output — not trackable deletions.
