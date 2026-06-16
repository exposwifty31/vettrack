# VetTrack native app (Capacitor)

The iOS/Android shell wraps the same React app and enables **native NFC** (Safari PWA cannot use Web NFC on iOS).

**Operator docs (read in order):**

| Doc | When |
|-----|------|
| This file | Build, install, env pitfalls |
| [native-ship-checklist.md](./mobile/native-ship-checklist.md) | Pre-submit route/device matrix |
| [native-mobile-implementation-manual.md](./mobile/native-mobile-implementation-manual.md) | Skills + burn-down workflow |
| [RESUBMISSION_RUNBOOK.md](../RESUBMISSION_RUNBOOK.md) | Clerk, archive, App Review |
| [nfc-ship-checklist.md](./mobile/nfc-ship-checklist.md) | NFC / deep-link device evidence |

---

## Architecture (current)

| Mode | Config | Use |
|------|--------|-----|
| **Bundled shell (ship)** | No `server.url` in `capacitor.config.json` | TestFlight / App Store — offline-capable web assets in `ios/App/App/public` |
| **Remote WebView (dev only)** | `CAPACITOR_SERVER_URL=https://vettrack.uk` | Staging smoke — **never archive** (Guideline 4.2 + OAuth breaks) |

Bundled shell details:

- WebView origin: `capacitor://localhost`
- API: absolute URLs via `VITE_API_ORIGIN` (e.g. `https://vettrack.uk`) — see `src/lib/api-origin.ts`
- Auth: Clerk baked via `VITE_CLERK_PUBLISHABLE_KEY`; native OAuth uses system browser (`src/lib/native-oauth.ts`)
- iOS safe areas: `contentInset: "never"` — CSS owns insets (`viewport-fit=cover`)

---

## Prerequisites

- Node 22+ · `pnpm install`
- **Xcode** (macOS) for iOS
- **Android Studio** for Android
- Apple Developer account for NFC entitlements on iOS

---

## Build bundled shell (TestFlight / simulator)

**Do not use `pnpm build && cap sync` for native archives.** Vite loads `.env.local` first, which blanks Clerk for local web dev and produces a **dev-bypass** native app.

Use the native shell script — reads **`.env` only** for `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_ORIGIN`:

```bash
./scripts/build-native-shell.sh              # vite build + cap sync ios
./scripts/build-native-shell.sh --android
./scripts/build-native-shell.sh --all
```

Or via pnpm:

```bash
pnpm cap:build:native          # same as build-native-shell.sh --ios
pnpm cap:build:native:android
```

Required in **`.env`** (not `.env.local`):

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_live_…
VITE_API_ORIGIN=https://vettrack.uk
```

Pre-archive verification:

```bash
./scripts/verify-resubmission.sh   # includes pk_live + vettrack.uk bundle checks
```

---

## Install on iOS Simulator

```bash
./scripts/install-ios-sim.sh              # iPad (A16) — default for checklist matrix
./scripts/install-ios-sim.sh --iphone     # iPhone 16 Pro
./scripts/install-ios-sim.sh --udid <UDID>
./scripts/install-ios-sim.sh --skip-build # reuse last cap sync
```

Or: `pnpm cap:install:ios-sim`

---

## Archive for TestFlight (human steps)

After `./scripts/build-native-shell.sh` and `./scripts/verify-resubmission.sh`:

1. `pnpm cap:open:ios`
2. Bump `CURRENT_PROJECT_VERSION` in Xcode
3. Product → Archive → Upload to App Store Connect

Full checklist: [RESUBMISSION_RUNBOOK.md](../RESUBMISSION_RUNBOOK.md) §C–§F.

---

## Local web dev vs native (env split)

| Surface | Env files | Auth |
|---------|-----------|------|
| `pnpm dev` (browser) | `.env.local` blanks Clerk | dev-bypass → `:3001` |
| Bundled Capacitor | `.env` via `build-native-shell.sh` | production Clerk + `vettrack.uk` API |

`.env.local` exists so live Clerk keys in `.env` do not break localhost. It must **never** drive a native archive build.

---

## Remote WebView (optional, not for submit)

Point the WebView at production without rebundling (staging only):

```bash
CAPACITOR_SERVER_URL=https://vettrack.uk pnpm cap:sync:remote
```

---

## iOS NFC (one-time per app ID)

1. Xcode → target → **Signing & Capabilities** → **Near Field Communication Tag Reading**
2. `ios/App/App/Info.plist` — `NFCReaderUsageDescription`
3. For non-NDEF tags, add **TAG** to `com.apple.developer.nfc.readersession.formats`

See [nfc.md](./mobile/nfc.md) for scan/write contracts.

---

## Android

`android.permission.NFC` is added by `cap sync` when `@capgo/capacitor-nfc` is installed.

---

## Code map

| File | Role |
|------|------|
| `capacitor.config.ts` | App id, `webDir`, optional `CAPACITOR_SERVER_URL` |
| `scripts/build-native-shell.sh` | Production bundled build + sync |
| `scripts/install-ios-sim.sh` | Simulator build + install |
| `scripts/verify-resubmission.sh` | Pre-archive gates (Clerk, CORS, bundle auth) |
| `src/lib/api-origin.ts` | `VITE_API_ORIGIN` for bundled shell only |
| `src/lib/capacitor-runtime.ts` | `isCapacitorNative()` |
| `src/lib/native-oauth.ts` | System-browser OAuth for Apple/Google |
| `src/lib/nfc-platform.ts` | Web NFC + `@capgo/capacitor-nfc` |

---

## Quick reference

```bash
# Correct native iteration loop
./scripts/build-native-shell.sh
./scripts/install-ios-sim.sh
# … test on device/sim …
./scripts/verify-resubmission.sh
pnpm cap:open:ios   # Archive

# Wrong for TestFlight (may ship dev-bypass)
pnpm build && npx cap sync ios
```
