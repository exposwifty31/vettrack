# VetTrack — Mobile Release Guide

---

## Versioning strategy

VetTrack uses a two-number version: `MARKETING_VERSION` (user-visible, e.g. `1.2.0`) and `CURRENT_PROJECT_VERSION` / `versionCode` (monotonically increasing integer). The web `BUILD_TAG` (injected by Vite at build time) is separate from the app version and used only for SW cache busting.

| Platform | User version | Build number |
|----------|-------------|-------------|
| iOS | `MARKETING_VERSION` in `App.xcodeproj` | `CURRENT_PROJECT_VERSION` |
| Android | `versionName` in `app/build.gradle` | `versionCode` |
| PWA / web | N/A | `__VT_BUILD_TAG__` (git SHA prefix) |

**Bump rule:**
- Patch: bug fixes, no new API surface (`1.0.x`)
- Minor: new features, backward compatible (`1.x.0`)
- Major: breaking changes, new onboarding required (`x.0.0`)
- Build number: increment on every submitted build (never reuse)

---

## Pre-release checklist

```bash
# 1. Ensure all tests pass
pnpm test
npx tsc --noEmit

# 2. Run release gate (manual pipeline trigger in GitLab)
# Go to GitLab → CI/CD → Pipelines → Run pipeline on main

# 3. Build production web bundle
pnpm build

# 4. Sync native projects
npx cap sync
```

---

## iOS release

### Requirements
- macOS with Xcode 15+
- Apple Developer account with App Store Connect access
- App ID `uk.vettrack.app` registered in App Store Connect
- Distribution certificate + provisioning profile configured in Xcode

### Steps

1. **Bump version in Xcode:**
   - Open `ios/App/App.xcodeproj` in Xcode
   - Target → General → set `MARKETING_VERSION` and increment `CURRENT_PROJECT_VERSION`

2. **Archive:**
   - Product → Archive
   - Wait for build to complete

3. **Upload to App Store Connect:**
   - In Organizer → Distribute App → App Store Connect → Upload

4. **Submit for review in App Store Connect**

### NFC entitlement (required once)
In Xcode → Target → Signing & Capabilities → add **Near Field Communication Tag Reading**.

### Feature flags (required for camera)

Camera capture and photo-library picking require `VITE_FEATURE_CAMERA=true` at **build time**. Set this in `.env` (or the CI/build environment) before `pnpm build` so production bundles include the camera UI (`src/lib/camera.ts`, `src/hooks/use-camera-capture.ts`). When unset, camera hooks report `enabled: false` and return `{ ok: false, error: "unsupported" }`.

### APNs push (required for native push)
1. Create APNs Authentication Key in Apple Developer portal (`.p8` file)
2. Set env vars on server:
   ```
   APNS_KEY_ID=<10-char key ID>
   APNS_TEAM_ID=<team ID>
   APNS_P8_KEY=<contents of .p8 file>
   ```

---

## Android release

### Requirements
- Android Studio with SDK 36 and build tools
- Google Play Console account with `uk.vettrack.app` app created
- Release keystore (never commit to git)

### Steps

1. **Bump version in `android/app/build.gradle`:**
   ```groovy
   versionCode 2          // increment every release
   versionName "1.1.0"    // user-visible
   ```

2. **Generate signed APK/AAB:**
   ```bash
   cd android
   ./gradlew bundleRelease   # AAB for Play Store
   # or
   ./gradlew assembleRelease # APK for sideload
   ```

3. **Sign with release keystore:**
   Configure in `android/app/build.gradle` under `signingConfigs`:
   ```groovy
   signingConfigs {
     release {
       storeFile file(System.getenv("KEYSTORE_PATH"))
       storePassword System.getenv("KEYSTORE_PASSWORD")
       keyAlias System.getenv("KEY_ALIAS")
       keyPassword System.getenv("KEY_PASSWORD")
     }
   }
   ```

4. **Upload to Play Console** → Create new release

### FCM push (required for native push)
1. Create a Firebase project, add `uk.vettrack.app` Android app
2. Download `google-services.json` → place in `android/app/`
3. Set env var on server:
   ```
   FCM_JSON=<stringified service account JSON>
   ```

---

## PWA release

PWA releases are automatic on every deploy to production:
1. `pnpm build` generates `dist/public` with a new `__VT_BUILD_TAG__` (git SHA prefix)
2. The service worker detects the new build tag and offers an update banner
3. Users refresh to get the new version

No store submission required.

---

## BUILD_TAG strategy

`__VT_BUILD_TAG__` is set by `scripts/vite-plugins/sw-build-tag.ts` at build time using the git commit SHA (first 8 chars). It is:
- Injected into `public/sw.js` as the `CACHE_NAME` suffix
- Available to client code via `import.meta.env.VITE_BUILD_TAG`
- Used for split-version detection via `BroadcastChannel`

For releases: the tag is automatically set from the git commit. No manual action needed.

---

## Changelog generation

Generate a changelog from conventional commits:
```bash
git log --oneline --no-merges v1.0.0..HEAD | grep -E "^[a-f0-9]+ (feat|fix|chore|docs|refactor)"
```

Or use `standard-version` / `conventional-changelog` if added to the project in the future.

---

## Rollback

- **Web/PWA:** redeploy previous commit to Railway; SW cache is invalidated by the new (old) build tag
- **iOS:** submit an expedited review with the previous version
- **Android:** use Play Console → Releases → Rollout → Halt or create a new release with the previous APK

See `docs/demo-rollback.md` for emergency rollback procedures.
