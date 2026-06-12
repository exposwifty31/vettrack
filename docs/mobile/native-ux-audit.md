# VetTrack — Native & Mobile UX Audit

**Date:** 2026-06-12
**Scope:** Capacitor native shells (iOS/Android), PWA install experience, native integrations (NFC, camera, OAuth, push), offline behavior on mobile.
**Evidence:** `capacitor.config.ts`, `src/lib/native-oauth.ts`, `src/lib/nfc-platform.ts`, `src/lib/camera.ts`, `src/lib/offline-emergency-block.ts`, `public/manifest.json`, `public/sw.js`, `ios/` + `android/` projects, `ARTIFACTS.md`, App Review history (`RESUBMISSION_RUNBOOK.md`).

---

## 1. Shell architecture

- Capacitor v8, appId `uk.vettrack.app`, `webDir: dist/public`.
- Two operating modes (`capacitor.config.ts`):
  - **Option A — remote WebView** (`CAPACITOR_SERVER_URL=https://vettrack.uk`): current production path. Web deploys reach native users instantly; no offline shell.
  - **Option B — bundled shell** (default config): offline-capable; **blocked** on the `capacitor://localhost` CORS allowlist + NativeClerkGate/api-origin work (currently uncommitted working-tree changes).
- iOS: `contentInset: "automatic"`; Android: `allowMixedContent: false`, minSdk 24, target/compileSdk 36.

## 2. Authentication UX (native)

- **Root cause of App Store rejection (2.1a):** Apple/Google block OAuth inside embedded WebViews; Clerk's default social buttons navigated the WKWebView directly to the provider and failed.
- **Fix shipped (`1c52f248`):** `src/lib/native-oauth.ts` opens the provider authorize URL in the system browser (`@capacitor/browser` → SFSafariViewController/ASWebAuthenticationSession), returns via custom scheme `vettrack://oauth-callback` handled by `@capacitor/app` `appUrlOpen`, completes Clerk sign-in/sign-up transfer. Used only when `isCapacitorNative()`.
- **Verified live:** production bundle (buildTag `1.1.2-mqa2zhbi`) contains the callback scheme.
- **Gap:** flow cannot be exercised headlessly — **device testing of Apple + Google sign-in is mandatory before resubmission** (module header documents this explicitly).

## 3. Native integrations

| Capability | Implementation | State |
|---|---|---|
| NFC | `@capgo/capacitor-nfc` v8 + Web NFC fallback (`src/lib/nfc-platform.ts`); scan/write/session API | ✅ shipped |
| Camera | `@capacitor/camera` ^8.2.0 via `src/lib/camera.ts` + `use-camera-capture.ts`; permission handling, compression, denial UX | ✅ feature-flagged (`VITE_FEATURE_CAMERA`, off by default) |
| OAuth | System-browser flow (`native-oauth.ts`) | ✅ shipped, device-test pending |
| Push | VAPID web push live; **APNs/FCM not integrated** — native shells receive no push | ❌ deferred (plan R2) |
| Privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` + entitlements present (working tree) | 🔶 uncommitted |

## 4. PWA install experience

- Manifest: `display: standalone`, 4 shortcuts, 1 screenshot, icons with purpose `any` (192/512). Narrow-screen (mobile form-factor) screenshot still absent; maskable icon variants not present as separate entries.
- Service worker: cache name `vettrack-<__VT_BUILD_TAG__>`; emergency endpoints unconditionally bypass Cache Storage; split-version detection via BroadcastChannel build-tag gossip; `ChunkLoadError` recovery with one-shot force reload.
- iOS home-screen installs run in Safari's PWA container — Web NFC unavailable there; the Capacitor shell is the NFC-capable path on iOS.

## 5. Offline & clinical safety on mobile

- Offline-first via Dexie + sync-engine FIFO with retries/circuit-breaker — equipment/rooms cached, mutations queued.
- **Emergency exception (frozen contract):** Code Blue mutations are classified by `classifyEmergencyEndpoint()` and never queued offline; offline attempts fail loud (toast + bounded counter). Session end is server-confirmed only.
- Mobile dead-zone behavior: last-known state rendered from cache; non-emergency mutations replay on reconnect via the reconciliation path (`visibilitychange`/`pageshow`/`online`/`freeze-resume`).

## 6. Mobile UX state (post-Phase-C)

- RTL logical properties (`ms-/me-/start-/end-`) applied repo-wide (T4.3); Hebrew is the default locale.
- Touch targets ≥44px on clinical surfaces; motion-safe animation caps (T4.1/T4.2).
- Single AppShell + nav-model across mobile and desktop; **mobile is the design source of truth** — desktop aligns to mobile.

## 7. Findings & recommendations

1. **[HIGH] Commit & push the native-shell working tree.** Entitlements, privacy manifest, Google services configs, CORS/NativeClerkGate work, and the deployed `1c52f248` exist only locally / unpushed. Risk: production regression and lost work. → master-plan R1.
2. **[HIGH] Device-test native OAuth before resubmitting.** The rejection class is only verifiable on hardware. → `RESUBMISSION_RUNBOOK.md`.
3. **[MEDIUM] APNs/FCM push for native shells.** Native users currently get no push at all. → master-plan R2.
4. **[MEDIUM] Native build validation in CI.** No pipeline job runs `cap sync`/Gradle/xcodebuild; breakage surfaces only at release time. → master-plan R3.
5. **[LOW] Manifest polish.** Add a narrow form-factor screenshot and dedicated maskable icon entries.
6. **[LOW] Option B readiness.** Once CORS work lands, validate the bundled shell offline path end-to-end before any Option B release. → master-plan R4.
