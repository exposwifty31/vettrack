# VetTrack Mobile Transformation

Living execution log for VetTrack's native mobile transformation (iOS + Android via Capacitor v8).

---

## Architecture

VetTrack's mobile strategy is a **Capacitor shell wrapping the React PWA**. The same codebase runs as:

- **PWA** — served from `dist/public` via the Express backend
- **iOS app** — Capacitor v8 shell in `ios/App/`, bundle ID `uk.vettrack.app`
- **Android app** — Capacitor v8 shell in `android/app/`, application ID `uk.vettrack.app`

### Key files

| File | Purpose |
|------|---------|
| `capacitor.config.ts` | Capacitor config (webDir, server URL, safe areas) |
| `ios/App/` | Xcode project — do not hand-edit generated files |
| `android/app/` | Android Gradle project |
| `src/lib/capacitor-runtime.ts` | `isCapacitorNative()`, `capacitorPlatform()` |
| `src/lib/nfc-platform.ts` | NFC abstraction (Web NFC + Capacitor native) |
| `src/lib/camera.ts` | Camera capture (feature-flagged) |
| `src/hooks/use-nfc-supported.ts` | NFC availability hook |
| `src/hooks/use-camera-capture.ts` | Camera capture hook |

---

## Native Plugins

| Plugin | Version | Purpose |
|--------|---------|---------|
| `@capacitor/core` | 8 | Core bridge |
| `@capacitor/ios` | 8 | iOS platform |
| `@capacitor/android` | 8 | Android platform |
| `@capacitor/app` | 8 | App lifecycle (foreground/background) |
| `@capacitor/cli` | 8 | Sync CLI |
| `@capgo/capacitor-nfc` | 8 | NFC read/write (iOS CoreNFC + Android NFC) |
| `@capacitor/camera` | 8.2.0 | Camera capture (feature-flagged) |

---

## Building

```bash
# 1. Build web bundle
pnpm build

# 2. Sync to native projects (copies dist/public + updates plugins)
npx cap sync

# 3a. Open in Xcode
npx cap open ios

# 3b. Open in Android Studio
npx cap open android
```

### Live server mode (staging/dev)
```bash
CAPACITOR_SERVER_URL=https://vettrack.uk pnpm cap:sync
```

---

## Platform Configuration

### iOS
- **Deployment target:** iOS 13+
- **Bundle ID:** `uk.vettrack.app`
- **Version:** 1.0 (build 1)
- **Capabilities required:** Near Field Communication Tag Reading
- **Privacy descriptions in Info.plist:**
  - `NFCReaderUsageDescription` — NFC equipment scanning
  - `NSCameraUsageDescription` — Photo capture for equipment records (present in `ios/App/App/Info.plist`)
  - `NSPhotoLibraryUsageDescription` — Photo library access (present in `ios/App/App/Info.plist`)
- **Safe areas:** `contentInset: "automatic"` handles notch/Dynamic Island

### Android
- **Min SDK:** 24 (Android 7.0)
- **Compile SDK:** 36
- **Target SDK:** 36
- **Application ID:** `uk.vettrack.app`
- **Version:** 1.0 (code 1)
- **Permissions in AndroidManifest.xml:**
  - `android.permission.INTERNET`
  - `android.permission.NFC` (`required: false`)
  - `android.permission.CAMERA` (present in `android/app/src/main/AndroidManifest.xml`)
- **RTL support:** `android:supportsRtl="true"` ✅

---

## Safe Areas

CSS `env(safe-area-inset-*)` variables are available via Capacitor's `contentInset: "automatic"` on iOS and the standard WebView on Android. All layout containers use `pb-safe` / `pt-safe` Tailwind classes where relevant.

---

## NFC

See [`docs/mobile/nfc.md`](nfc.md) for the complete NFC architecture, platform limits, and backend contracts.

---

## Camera

Camera is implemented behind `VITE_FEATURE_CAMERA=true`. See `src/lib/camera.ts` for the abstraction and `src/hooks/use-camera-capture.ts` for the React hook.

Validation on iOS simulator and Android emulator is pending physical device / runner access.

---

## Push Notifications

Web push is fully implemented via the VAPID/web-push stack. APNs and FCM native push requires:

1. APNs p8 key (from Apple Developer) + `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_P8_KEY` env vars
2. FCM JSON service account file + `FCM_JSON` env var
3. Capacitor Push Notifications plugin (`@capacitor/push-notifications`) — **not yet installed**

See [`docs/mobile/release.md`](release.md) for production push setup steps.

---

## Device Testing Matrix

| Device | Size | Status |
|--------|------|--------|
| iPhone SE (3rd gen) | 375×667 | Pending |
| iPhone 15 Pro | 393×852 | Pending |
| iPhone 15 Pro Max | 430×932 | Pending |
| iPad (10th gen) portrait | 820×1180 | Pending |
| iPad (10th gen) landscape | 1180×820 | Pending |
| Android phone (Pixel 7) | 412×915 | Pending |
| Android tablet (Pixel Tablet) | 1280×800 | Pending |

Screenshots stored in `artifacts/mobile/` once captured.

---

## Known Issues

- None open. Gaps tracked in `ARTIFACTS.md`.
