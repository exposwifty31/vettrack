# VetTrack — Pre-Submission Audit (new version)

**Date:** 2026-06-29
**Repo audited:** `vettrack-ship` (Capacitor iOS shell, `appId uk.vettrack.app`, bundled web app — no `server.url`)
**Context:** Build 14 / v1.0.1 approved and live. Preparing a **new version** before archive + App Store Connect upload.
**Scope:** App Store review-risk, backend API, frontend/UX, accessibility, security, build health.

---

## Verdict

The codebase is mature, disciplined, and largely submission-ready. The previous rejection items (5.1.1(v) account deletion, 2.1 Apple sign-up, 2.3.8 placeholder icon) are genuinely fixed and verifiable in the tree. Typechecks pass clean. **One blocker must be resolved before archive: the version number.** Everything else is hardening, not a gate.

| Severity | Count | Gate submission? |
|---|---|---|
| 🔴 Blocker | 1 | Yes |
| 🟠 High | 2 | Recommended before upload |
| 🟡 Medium | 3 | Soon |
| 🟢 Low | 3 | Optional |

---

## 🔴 BLOCKER

### B1 — Version number still says `1.0.1`; you can't re-submit under an already-released version
- **Xcode** `project.pbxproj`: `MARKETING_VERSION = 1.0.1`, `CURRENT_PROJECT_VERSION = 20`.
- **package.json**: `version: 1.1.2`.
- **RESUBMISSION_RUNBOOK.md** (last verified 2026-06-17) still targets `1.0.1 (20)` as a *resubmission* after the build-15 rejection — i.e. it was written when 1.0.1 was **in review**, not live.
- You now say 1.0.1 (build 14) is **approved and on air**. Once a version is "Ready for Sale," App Store Connect will **not** let you attach a new build to it — you must create a **new version number**.

**Fix (must happen before archive):**
1. Decide the new marketing version. Recommended: **`1.1.0`** (new feature release; also gets Xcode and package.json onto one track). `1.0.2` is the alternative if you want to signal a patch.
2. Set `MARKETING_VERSION` in Xcode to the chosen value (both the App and the `VetTrackControl` target).
3. Use a build number **greater than any already uploaded** under 1.0.1 (builds 15–20 may be consumed). Bump `CURRENT_PROJECT_VERSION` to **21+**.
4. Align `package.json` to match, then `pnpm build && npx cap sync ios` so the shell carries the new version.
5. Create the new version in App Store Connect and attach the fresh build.

> The runbook is now **stale** on version/state. Confirm the live App Store Connect state (is 1.0.1 "Ready for Sale"?) before trusting its "Resubmit" steps.

---

## 🟠 HIGH

### H1 — No app-level privacy manifest (`PrivacyInfo.xcprivacy`)
- The only `.xcprivacy` files in the tree belong to the Capacitor/Cordova frameworks and the camera plugin checkout. There is **no app-level** `ios/App/App/PrivacyInfo.xcprivacy`.
- Apple requires a privacy manifest declaring **Required Reason API** usage. Capacitor apps almost always trip this (e.g. `UserDefaults` → reason `CA92.1`/`C56D.1`, file-timestamp APIs, system boot time). Missing/incomplete manifests trigger the **ITMS-91053** "Missing API declaration" email and, increasingly, upload rejection.
- **Fix:** add `ios/App/App/PrivacyInfo.xcprivacy` declaring `NSPrivacyAccessedAPITypes` for the reasons your app + plugins use (at minimum UserDefaults `CA92.1`), plus `NSPrivacyTracking = false` and any collected data types (you collect account data via Clerk). Add it to the App target in Xcode. Verify with a test upload — Apple emails warnings within ~30 min of processing.

### H2 — Dev `.env` points at the **live** Clerk instance and live API
- `.env` (gitignored ✓, not committed) contains `CLERK_SECRET_KEY` **twice** — `sk_test_…` then `sk_live_…`. The later live value wins. `VITE_API_ORIGIN` is also production.
- Not a submission blocker, but it means local dev runs against **live auth + live data** — easy to mutate production users/clinics by accident, contradicting the runbook's own "this file never contains the live Clerk key" policy.
- **Fix:** remove the duplicate, keep only `sk_test_…` locally, source live secrets from Railway at deploy time. Rotate the live key if it's been shared in plaintext anywhere.

---

## 🟡 MEDIUM

### M1 — `UIRequiredDeviceCapabilities = armv7`
- Info.plist requires `armv7` (32-bit). Deployment target is iOS 15 (64-bit only). A leftover Capacitor default. Harmless today but technically wrong and can confuse device-capability filtering. Change to `arm64`.

### M2 — Multi-tenancy: spot-verify `clinicId` filtering before ship
- Heuristic only: 244 of 430 `.where(` clauses in routes/services mention `clinicId` on the same line (many others span lines or are subqueries, so this is **not** a defect count). The CLAUDE.md rule is "every query filters by `clinicId`."
- **Fix:** run `pnpm tenant:lint:all` and review any flagged queries. This is the highest-impact data-isolation risk for a multi-clinic app; worth a clean pass before a release.

### M3 — Push environment is `production` for a dev device install
- `aps-environment = production` in entitlements. Fine for the App Store build; just note push won't register when you run a **development**-signed build on your iPhone via Xcode unless the provisioning profile matches. Not a code change — expectation-setting for the build step.

---

## 🟢 LOW

- **L1** — `MessageBubble.tsx` uses `dangerouslySetInnerHTML`, but input is `escapeHtml()`-ed before the @mention span is injected. **Safe** — no action needed; noted for review awareness.
- **L2** — 12 `TODO(arch)` markers (god-file splits >1100 lines in `users.ts`, `containers.ts`, `code-blue.ts`, `equipment.ts`; phase-5 enforcement stubs). Tracked tech debt, not bugs.
- **L3** — 2 `console.log` in `src`. Trivial prod noise; strip if you want clean release logs.

---

## What's already solid (verified, no action)

- **Account deletion (5.1.1(v)):** `delete-account-dialog.tsx` → `DELETE /api/users/delete-account` → Apple token revocation (`server/lib/apple-auth.ts`), demo account self-delete protected. ✅
- **Info.plist usage strings:** NFC, Camera, PhotoLibrary, PhotoLibraryAdd all present and specific. ✅
- **Export compliance:** `ITSAppUsesNonExemptEncryption = false` set (no per-upload prompt). ✅
- **ATS:** only `NSAllowsLocalNetworking` — no arbitrary-loads escape hatch. ✅
- **Native OAuth path:** system-browser Clerk + `clerk-native-instance-*.js` chunk present in `ios/App/App/public`. ✅
- **Bundled shell, synced:** `dist/public/index.html` == `ios/App/App/public/index.html`. ✅
- **Icon:** single 1024 `AppIcon-512@2x.png` present (runbook verified alpha-stripped). ✅
- **Typechecks:** client `tsc --noEmit` and server `tsc -p tsconfig.server.json` both **pass clean**. ✅
- **i18n parity:** en/he exactly 3195/3195 keys, zero missing either direction. ✅
- **Error boundaries:** app-level + page-level + per-page. ✅
- **Code health:** zero `@ts-ignore`, one (safe) `dangerouslySetInnerHTML`. ✅
- **iPhone layout:** `viewport-fit=cover` + 20 files using `safe-area-inset` + `contentInset: "never"` — notch/Dynamic Island handled. (Confirm visually on-device in the build step.) ✅

---

## Recommended pre-archive sequence

1. Resolve **B1** (set new version + build number, align package.json).
2. Add **H1** privacy manifest.
3. Fix **H2** `.env`, run **M2** `pnpm tenant:lint:all`.
4. `pnpm build && npx cap sync ios`.
5. Run the runbook's §C pre-archive verification (demo login `complete`, Clerk config, icon, bundled-shell checks).
6. Archive → upload → confirm Apple's privacy/encryption emails are clean.

> **Build note:** the production `vite build` could not be reproduced in this Linux sandbox — `@rollup/rollup-linux-arm64-gnu` is missing because `node_modules` was installed for macOS. This is **not** a code issue; the build runs on your Mac (dist is freshly built) and both typechecks are green.
