# Plan: Align Home Update Banner with Native App Version

## Summary
The home-screen **UpdateBanner** shows **v1.1.2** because it reads `GET /api/version`, which returns `package.json` semver (web/backend). The native iOS app ships **MARKETING_VERSION 1.0.1** and the What's New page displays **v1.0.1** from locale keys. This plan makes the banner (and Settings version label) use the **native shell version** when running inside Capacitor, while preserving the existing web/PWA behavior.

## User Story
As a VetTrack staff member using the native iOS app,
I want the home "what's new" banner to show the same version as the app and What's New page,
So that release messaging is consistent and trustworthy.

## Problem → Solution
**Current:** `UpdateBanner` → `authFetch("/api/version")` → `package.json` **1.1.2** → banner text "VetTrack v1.1.2 is here". What's New page → `t.whatsNew.currentVersion` → **1.0.1**. iOS `MARKETING_VERSION` → **1.0.1**.

**Desired:** In Capacitor native shell, banner and Settings use `App.getInfo().version` (MARKETING_VERSION). Web/PWA continues using `/api/version`. Locale `whatsNew.currentVersion` / `buildLabel` stay manually synced with Xcode on each native release (existing release workflow).

## Metadata
- **Complexity**: Small
- **Source PRD**: N/A (native-ship advisory #109 / #146 in `docs/mobile/native-ship-checklist.md`)
- **PRD Phase**: N/A
- **Estimated Files**: 5–7

---

## UX Design

### Before
```
┌─────────────────────────────────────────────┐
│ ✨ VetTrack v1.1.2 is here — see what's new │  ← UpdateBanner (native home)
├─────────────────────────────────────────────┤
│  Today dashboard …                          │
└─────────────────────────────────────────────┘

/whats-new page badge:  v1.0.1 · Build 13
Settings → About:       Version 1.1.2        (__APP_VERSION__ from package.json)
```

### After
```
┌─────────────────────────────────────────────┐
│ ✨ VetTrack v1.0.1 is here — see what's new │  ← matches native MARKETING_VERSION
├─────────────────────────────────────────────┤
│  Today dashboard …                          │
└─────────────────────────────────────────────┘

/whats-new page badge:  v1.0.1 · Build 16     (locale sync — release checklist)
Settings → About:       Version 1.0.1
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Home UpdateBanner (native) | v1.1.2 from API | v1.0.1 from `App.getInfo()` | Only when `isCapacitorNative()` |
| Home UpdateBanner (web/PWA) | v1.1.2 from API | unchanged | `/api/version` remains source |
| Settings version label (native) | `__APP_VERSION__` (1.1.2) | native marketing version | Same helper as banner |
| What's New badge | locale `1.0.1` | locale `1.0.1` + build **16** | Manual bump per release |
| Dismiss persistence | `vettrack-last-seen-version` | same key, native semver stored | No storage key change |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 (critical) | `src/components/update-banner.tsx` | 1–81 | Banner fetches `/api/version` today |
| P0 (critical) | `src/lib/capacitor-runtime.ts` | 1–11 | `isCapacitorNative()` guard pattern |
| P0 (critical) | `src/lib/deep-link-router.ts` | 1–6 | Existing `@capacitor/app` import pattern |
| P1 (important) | `docs/mobile/release.md` | 5–19 | Native vs web version strategy |
| P1 (important) | `src/pages/whats-new.tsx` | 33–99 | Locale-driven release badge |
| P1 (important) | `src/pages/settings.tsx` | 631–646 | Settings version display |
| P2 (reference) | `server/index.ts` | 63–84 | `/api/version` contract (unchanged) |
| P2 (reference) | `docs/mobile/native-ship-checklist.md` | 109, 146 | Documented advisory A-1 |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Capacitor App plugin | `@capacitor/app` (already dep `8`) | `App.getInfo()` returns `{ version, build }` from Info.plist |
| iOS versioning | `docs/mobile/release.md` | `MARKETING_VERSION` = user version; `CURRENT_PROJECT_VERSION` = build |

No external research needed beyond established internal patterns.

---

## Patterns to Mirror

### NATIVE_RUNTIME_GUARD
// SOURCE: src/lib/capacitor-runtime.ts:3-6
```typescript
export function isCapacitorNative(): boolean {
  return Capacitor.isNativePlatform();
}
```

### CAPACITOR_APP_IMPORT
// SOURCE: src/lib/deep-link-router.ts:1-2
```typescript
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
```

### UPDATE_BANNER_VERSION_FETCH
// SOURCE: src/components/update-banner.tsx:26-37
```typescript
useEffect(() => {
  if (!isSignedIn || !userId) return;
  authFetch("/api/version")
    .then((r) => r.json())
    .then((data: { version: string }) => {
      const serverVersion = data.version;
      const lastSeen = safeStorageGetItem(STORAGE_KEY);
      if (!lastSeen || compareVersions(serverVersion, lastSeen) > 0) {
        setBannerVersion(serverVersion);
      }
    })
    .catch(() => {});
}, [isSignedIn, userId]);
```

### VERSION_COMPARE
// SOURCE: src/components/update-banner.tsx:12-19
```typescript
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
```

### I18N_RELEASE_VERSION
// SOURCE: locales/en.json:3456-3463
```json
"whatsNew": {
  "currentVersion": "1.0.1",
  "currentDate": "June 2026",
  "buildLabel": "Build 13",
```

### SETTINGS_VERSION_DISPLAY
// SOURCE: src/pages/settings.tsx:636-637
```typescript
{t.settingsPage.versionLabel} <span data-testid="app-version">{__APP_VERSION__}</span>
```

### TEST_STRUCTURE
// SOURCE: tests/build-info.test.ts:7-15
```typescript
describe("build-info contract", () => {
  it("vitePilotMode is only true when explicitly enabled at build", () => {
    const vitePilotMode = process.env.VITE_PILOT_MODE === "true";
    // ...
  });
});
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/app-version.ts` | CREATE | Shared resolver: native `App.getInfo()` vs `__APP_VERSION__` / API |
| `src/components/update-banner.tsx` | UPDATE | Use native resolver instead of raw `/api/version` on Capacitor |
| `src/pages/settings.tsx` | UPDATE | Show resolved display version in About section |
| `locales/en.json` | UPDATE | Sync `whatsNew.buildLabel` → `Build 16` (matches `CURRENT_PROJECT_VERSION`) |
| `locales/he.json` | UPDATE | Parity: `buildLabel` → `בילד 16` |
| `tests/app-version.test.ts` | CREATE | Unit tests for version resolver + compare helper extraction |
| `docs/mobile/release.md` | UPDATE | Add release-step: bump locale `whatsNew` when bumping Xcode version |

## NOT Building

- Changing `package.json` version (web **1.1.2** stays — separate semver track per `docs/mobile/release.md`)
- Changing `/api/version` server response
- Auto-syncing locale `currentVersion` from Xcode at build time (future enhancement; out of scope)
- Changing What's New content/highlights copy
- Android-specific changes beyond shared Capacitor `App.getInfo()` path

---

## Step-by-Step Tasks

### Task 1: Extract shared version utilities
- **ACTION**: Create `src/lib/app-version.ts` with pure helpers
- **IMPLEMENT**:
  - Export `compareVersions(a, b)` — move from `update-banner.tsx` (or re-export)
  - Export `getBundledAppVersion(): string` → `typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0"`
  - Export `async function resolveDisplayAppVersion(): Promise<string>`:
    - If `!isCapacitorNative()` → return `getBundledAppVersion()`
    - Else → `const { version } = await App.getInfo(); return version`
  - Export `async function resolveServerAppVersion(): Promise<string | null>` — existing `authFetch("/api/version")` parse; return `null` on failure
- **MIRROR**: `src/lib/capacitor-runtime.ts` guard + `src/lib/deep-link-router.ts` App import
- **IMPORTS**: `@capacitor/app`, `@/lib/capacitor-runtime`, `@/lib/auth-fetch`
- **GOTCHA**: `App.getInfo()` is async — callers must await in `useEffect`; do not call on SSR (Vite client-only; guard with `typeof window !== "undefined"` if needed)
- **VALIDATE**: `npx tsc --noEmit` passes; no new unused exports

### Task 2: Update home UpdateBanner
- **ACTION**: Branch version source by platform
- **IMPLEMENT**:
  - Import `resolveDisplayAppVersion`, `resolveServerAppVersion`, `compareVersions` from `@/lib/app-version`
  - In `useEffect`:
    ```typescript
    const displayVersion = isCapacitorNative()
      ? await resolveDisplayAppVersion()
      : (await resolveServerAppVersion()) ?? getBundledAppVersion();
    const lastSeen = safeStorageGetItem(STORAGE_KEY);
    if (!lastSeen || compareVersions(displayVersion, lastSeen) > 0) {
      setBannerVersion(displayVersion);
    }
    ```
  - Remove inline `compareVersions` if moved to lib
- **MIRROR**: Existing dismiss + storage key behavior unchanged
- **IMPORTS**: `isCapacitorNative` from `@/lib/capacitor-runtime`
- **GOTCHA**: On web, keep server version as today (not bundled `__APP_VERSION__`) so banner reflects deployed backend release. Only native uses client marketing version.
- **VALIDATE**: Native sim shows **v1.0.1**; web dev still shows **v1.1.2** when API returns that

### Task 3: Fix Settings About version (native)
- **ACTION**: Replace static `__APP_VERSION__` with resolved version
- **IMPLEMENT**:
  - `const [displayVersion, setDisplayVersion] = useState(getBundledAppVersion())`
  - `useEffect(() => { void resolveDisplayAppVersion().then(setDisplayVersion); }, [])`
  - Render `displayVersion` in `data-testid="app-version"` span
- **MIRROR**: `src/components/report-issue-dialog.tsx:47` pattern for `__APP_VERSION__` fallback
- **GOTCHA**: Settings page is auth-guarded; no signed-in gate needed for version read
- **VALIDATE**: Settings About shows **1.0.1** in native sim, **1.1.2** in browser

### Task 4: Sync locale build label with Xcode
- **ACTION**: Update `whatsNew.buildLabel` in both locale files
- **IMPLEMENT**:
  - `locales/en.json`: `"buildLabel": "Build 16"` (grep `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` — currently **16**)
  - `locales/he.json`: `"buildLabel": "בילד 16"`
  - Keep `currentVersion: "1.0.1"` (already matches `MARKETING_VERSION`)
- **MIRROR**: Existing `whatsNew` key structure
- **GOTCHA**: Run `pnpm i18n:generate` or whatever script regenerates `src/lib/i18n.generated.d.ts` if buildLabel type is affected (string value only — likely no codegen needed)
- **VALIDATE**: `pnpm test -- tests/i18n-parity.test.ts` passes

### Task 5: Unit tests
- **ACTION**: Add `tests/app-version.test.ts`
- **IMPLEMENT**:
  - Test `compareVersions("1.1.2", "1.0.1") > 0`
  - Test `compareVersions("1.0.1", "1.0.1") === 0`
  - Mock `isCapacitorNative` + `App.getInfo` via `vi.mock` to assert native path returns `"1.0.1"`
  - Mock web path returns `getBundledAppVersion()`
- **MIRROR**: `tests/build-info.test.ts` vitest style
- **GOTCHA**: Do not import Capacitor in tests without mocks — will throw in node env
- **VALIDATE**: `pnpm test -- tests/app-version.test.ts` green

### Task 6: Release docs touch-up
- **ACTION**: Add one bullet to `docs/mobile/release.md` pre-release checklist
- **IMPLEMENT**: After "Bump version in Xcode", add: "Update `whatsNew.currentVersion` and `whatsNew.buildLabel` in `locales/en.json` + `locales/he.json` to match `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`."
- **VALIDATE**: Doc renders; no code impact

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| compareVersions greater | `1.1.2`, `1.0.1` | `> 0` | no |
| compareVersions equal | `1.0.1`, `1.0.1` | `0` | no |
| native resolver | mocked `App.getInfo` → `1.0.1` | `"1.0.1"` | yes |
| web resolver | `isCapacitorNative` false | `__APP_VERSION__` | no |
| banner hidden when seen | lastSeen `1.0.1`, display `1.0.1` | no banner | yes |

### Edge Cases Checklist
- [ ] User dismisses banner → `vettrack-last-seen-version` stores native semver
- [ ] Native app after Xcode bump to 1.0.2 → banner reappears if lastSeen is 1.0.1
- [ ] `/api/version` network failure on web → banner hidden (no false positive)
- [ ] Capacitor `App.getInfo()` failure → fall back to `getBundledAppVersion()`, no crash
- [ ] Signed-out user → banner not fetched (existing guard)

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
pnpm test -- tests/app-version.test.ts
pnpm test -- tests/i18n-parity.test.ts
```
EXPECT: All pass

### Full Test Suite
```bash
pnpm test
```
EXPECT: No regressions

### Native shell rebuild + spot check
```bash
./scripts/build-native-shell.sh
./scripts/install-ios-sim.sh
```
EXPECT: Home banner shows **v1.0.1**; `/whats-new` badge **v1.0.1 · Build 16**; Settings About **1.0.1**

### Manual Validation
- [ ] Sign in on iOS sim → home shows banner **v1.0.1** (or dismiss works)
- [ ] Tap "see what's new" → `/whats-new` badge matches banner major version
- [ ] Settings → About version matches banner
- [ ] Browser `localhost:5000/home` → banner still shows web version from API (**1.1.2**)
- [ ] Dismiss banner → reload → banner stays hidden until version bumps

---

## Acceptance Criteria
- [ ] Native home UpdateBanner displays **1.0.1**, not **1.1.2**
- [ ] What's New page version badge matches native marketing version
- [ ] Settings About version matches on native
- [ ] Web/PWA banner behavior unchanged (server-driven)
- [ ] `npx tsc --noEmit` zero errors
- [ ] New unit tests pass
- [ ] Locale parity maintained (en/he)
- [ ] No change to `/api/version` contract

## Completion Checklist
- [ ] Code follows `isCapacitorNative()` + `@capacitor/app` patterns
- [ ] `compareVersions` not duplicated
- [ ] No hardcoded `"1.0.1"` in TS/TSX (version from runtime or locale only)
- [ ] Release doc updated for locale sync step
- [ ] Self-contained — implementer needs no further codebase search

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Locale `currentVersion` drifts from Xcode on future releases | Medium | Medium | Document in `release.md`; optional future build-script sync |
| Users who dismissed banner at 1.1.2 won't see 1.0.1 banner | Low | Low | Acceptable — native users likely never saw consistent 1.0.1 banner before; dismiss key stores semver not build |
| `App.getInfo()` unavailable in test/dev web | Low | Low | Guard with `isCapacitorNative()` |

## Notes

- **Root cause** documented in `docs/mobile/native-ship-checklist.md` advisory #109: web `package.json` **1.1.2** vs native **1.0.1** is intentional dual-track versioning; the bug is the banner using the wrong track on native.
- `ios/App/App.xcodeproj/project.pbxproj` currently has `MARKETING_VERSION = 1.0.1` and `CURRENT_PROJECT_VERSION = 16` (locales still say Build 13 — sync in Task 4).
- `__APP_VERSION__` from Vite `define` will remain `package.json` version in all bundles; native **display** should not rely on it for user-facing labels.
