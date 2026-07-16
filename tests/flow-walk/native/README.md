# Native (iOS) flow walk — Appium / WebdriverIO

The native half of the Phase-10 III.6 walk. Drives the Capacitor iOS shell in the
Simulator, switches into its WKWebView, and asserts the manifest's
`expectedNativeOutcome` for every `iphone` / `ipad` row.

This sub-package is **intentionally isolated** from the repo root: `appium` and the
`xcuitest` driver are heavy and macOS/Xcode-specific, so they are only installed when
you actually run the native walk. The root `pnpm install` and CI never touch them.

## Why it's separate from the web walk

On the desktop web target the whole app is a management console (T-31 / R-WEB-01):
`AuthGuard` shows `ManagementWebGate` to any non-`management.web` role, preempting the
per-route guards. **On the mobile target that gate is inert.** So the native walk is
the only place that proves the guards that actually run on device:

| Guard | Native outcome |
|---|---|
| `AuthGuard` page | renders in the mobile/tablet shell |
| `WebOnlyGuard` / management console | `Redirect` → `/home` |
| `CustodyGuard` + student | `Redirect` → `/equipment` |
| `<Redirect>` legacy route | redirects to its target |

## Prerequisites

1. **A dev-bypass native shell pointed at a LOCAL server.** From the repo root, with a
   walk server running (`pnpm dev:walk` — API on `:3001`, Vite on `:5000`):
   ```bash
   xcrun simctl boot "iPhone 17"   # then grab its UDID: xcrun simctl list devices booted
   CAPACITOR_SERVER_URL=http://localhost:5000 npx cap sync ios
   CAPACITOR_SERVER_URL=http://localhost:5000 npx cap run ios --target <sim-udid>
   ```
   Do **not** use `pnpm cap:build:native` here — `build-native-shell.sh` deliberately
   strips `CAPACITOR_SERVER_URL` (App Review 4.2), so it always produces a *bundled*
   shell. `capacitor.config.ts` reads the env at sync/run time, and the Simulator
   shares the host network, so `localhost:5000` reaches the Mac's Vite server.
   (See `docs/audit/phase-0-2-device-audit-*` for the SPM-not-Pods playbook.)
   Do **not** ship Clerk keys — the walk needs dev-bypass so the `vt:devRole` switch works.

2. **Install this harness** (once) — with **npm**, not pnpm: running `pnpm add` in this
   directory injects a `tests/flow-walk/native` importer into the ROOT `pnpm-lock.yaml`,
   which would make every root install (and CI) pull Appium — exactly the coupling this
   package exists to avoid. `package-lock.json` is the lockfile here.
   ```bash
   cd tests/flow-walk/native
   npm install
   npm run appium:doctor       # verify the xcuitest driver toolchain
   ```

3. The app is reached via `BUNDLE_ID` (default `uk.vettrack.app`, already installed by
   `cap run`); export `APP_PATH=/path/to/App.app` instead to install a fresh build.

## Run

```bash
# SIM_UDID pins the exact simulator (device names repeat across installed runtimes).
SIM_UDID=<sim-udid> SIM_DEVICE_NAME="iPhone 17" npm run walk:iphone
SIM_UDID=<sim-udid> SIM_DEVICE_NAME="iPad Pro 11-inch (M5)" npm run walk:ipad
```

## Permission prompts (Phase 0b)

`wdio.conf.ts` sets `appium:autoAcceptAlerts: true`, so camera / NFC / notification
prompts are accepted automatically and can't stall the walk. If you instead want to
*assert* the prompt copy, drop that flag and grant per-permission with
`xcrun simctl privacy booted grant <service> uk.vettrack.app`.

## Two seams a booted sim must confirm

Both are marked `TODO(sim)` in `native-walk.e2e.ts`:

1. **Navigation** uses `history.pushState` + a `popstate` event (wouter listens to it).
   If a route doesn't pick it up under Capacitor, switch to the app's deep-link scheme.
2. **Render assertions** currently check only "no error boundary". Tighten each row to a
   per-page content marker once the seeded sim state is known (e.g. the equipment list
   needs `custody_state != untracked` to populate — a known device-audit gotcha).
