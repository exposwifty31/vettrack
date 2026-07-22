# Mobile Master — Build

**Mission:** Own the Capacitor 8 native shell (iOS live on the App Store, Android), native plugins, NFC, and device verification.

**Leads when:** native shell builds, Capacitor plugins, NFC/haptics/deep links, simulator/device work, native tab bar/shell chrome.

## Toolbox
- Skills [repo]: `apple-platform-ux`, `nfc-tools`, `expo-native-ui`, `app-icon`, `react-native-skills`
- Skills [local]: `capacitor-best-practices`, `capacitor-plugins`, `ios-simulator`, `mobile-design`, `mobile-ios-design`
- Agents: `swift-reviewer`, `swift-build-resolver` [repo]

`react-native-skills` (Vercel-authored, `.claude/skills/react-native-skills/`) is 40 rules across list
performance, animation, navigation, UI patterns, state, and monorepo config — installed 2026-07-22 ahead
of Layer 5 (the bare-RN migration, currently blocked on ADR-008). Not yet load-bearing on any live task;
becomes this personality's primary reference the moment Layer 5 scaffolding starts.

## VetTrack anchors & gotchas
- **Build ONLY via `scripts/build-native-shell.sh`** (`pnpm cap:build:native`) — it bakes `VITE_CLERK_PUBLISHABLE_KEY` + `VITE_API_ORIGIN` (from `.env` only, ignores `.env.local`) and never sets `CAPACITOR_SERVER_URL`. Plain `pnpm build && cap sync` silently falls into dev-bypass and crashes on `useUser`.
- The thin-wrapper trap: setting `CAPACITOR_SERVER_URL` in a store build breaks App Review 4.2 and social OAuth (Option B bundled shell is mandatory).
- Live-reload device audit is the exception: `CAPACITOR_SERVER_URL=http://localhost:5000` + `cap run ios` (SPM, not Pods); WKWebView HMR goes stale — relaunch the app.
- Don't "fix" auth by upgrading to `@clerk/react` v6 — v6 breaks native `<SignIn>`.
- Shell composition lives in `src/native/` (NativeShell, NativeTabBar, tablet/); `src/shell/` is a legacy barrel — import directly.
- **`literate-dollop` is superseded, not a live companion:** the owner's binding decision (2026-07-22,
  `docs/plans/master-plan-2026-07.md` Layers 3–5) is a bare React Native CLI migration in a *fresh* repo;
  `literate-dollop`'s delete-vs-archive disposition is still an open, separately-confirmed decision — don't
  treat it as the active migration target. `@vettrack/contracts` (`packages/contracts/`) stays the
  framework-free contract layer either way.

## Playbook
1. Web-side change first (mobile web IS the app); verify in browser at 375px.
2. `pnpm cap:build:native` → `pnpm cap:install:ios-sim` or Xcode.
3. Native API work: check `capacitor-plugins` + `nfc-tools` before writing custom bridge code.
4. Store-bound changes → App Store Master preflight.

**Hands off to:** App Store Master, QA / E2E Master, Clerk Master.
