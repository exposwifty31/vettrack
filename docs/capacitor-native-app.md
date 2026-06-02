# VetTrack native app (Capacitor — Equipment Hero phase 5)

The iOS/Android shell wraps the same React app and enables **native NFC** on iPhones and iPads (Safari does not expose Web NFC).

## Prerequisites

- Node 22+ and `pnpm install`
- **Xcode** (macOS) for iOS builds
- **Android Studio** for Android builds
- Apple Developer account for NFC entitlements on iOS

## Build the web bundle

```bash
pnpm build
```

Output: `dist/public` (configured as `webDir` in `capacitor.config.ts`).

## Sync native projects

```bash
pnpm cap:sync
```

Runs `pnpm build` then `npx cap sync` (copies web assets into `ios/` and `android/`).

## Run on device / simulator

```bash
pnpm cap:open:ios
# or
pnpm cap:open:android
```

Then run from Xcode or Android Studio.

## Live server mode (optional)

Point the WebView at production or staging without rebundling:

```bash
CAPACITOR_SERVER_URL=https://vettrack.uk pnpm cap:sync
```

Use only over HTTPS in production. Cleartext is allowed only for `http://` dev URLs.

## iOS NFC setup (required once per app ID)

1. In Xcode → target → **Signing & Capabilities**, add **Near Field Communication Tag Reading**.
2. In `ios/App/App/Info.plist`, ensure:

```xml
<key>NFCReaderUsageDescription</key>
<string>VetTrack reads NFC tags to identify equipment at the dock and bedside.</string>
```

3. For dock tags that are not NDEF-formatted, add the **TAG** format to the NFC entitlements array (`com.apple.developer.nfc.readersession.formats`).

## Android

`android/app/src/main/AndroidManifest.xml` must include `android.permission.NFC` (added by `cap sync` when the plugin is installed).

## Behaviour vs PWA

| Surface | Safari PWA | Capacitor app |
|--------|------------|---------------|
| QR scan | Yes | Yes |
| Equipment NFC toggle / dock / write tag | No | Yes (native plugin) |
| Service worker | Yes | Skipped in native shell |
| Clerk sign-in | Browser | In-app WebView (production host) |

## Code map

- `capacitor.config.ts` — app id, webDir, optional `CAPACITOR_SERVER_URL`
- `src/lib/capacitor-runtime.ts` — `isCapacitorNative()`
- `src/lib/nfc-platform.ts` — Web NFC + `@capgo/capacitor-nfc` bridge
- `src/hooks/use-nfc-supported.ts` — UI capability probe
