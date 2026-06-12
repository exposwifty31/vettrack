# VetTrack — App Review Resubmission Runbook (build 1.0 (4))

Addresses the three rejection items from Submission `9f5acacc-…` (June 11, 2026):
- **2.3.8** placeholder icon
- **2.1(a)** error when registering with Apple
- **2.1** demo account login failed

---

## What's already done (by Claude)

| Item | Status | Where |
|------|--------|-------|
| 2.3.8 icon — replaced placeholder, **stripped alpha channel** (Apple rejects transparent icons) | ✅ Done | `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` |
| 2.1 demo password — reset `reviewer@vettrack.uk` to `VetTrack2026!` | ✅ Done | Clerk dashboard (Production) |
| 2.1a code — system-browser OAuth for Apple + Google in the native shell | ✅ Code done | see "Files changed" below |
| Clerk redirect scheme allow-listed | ✅ Done | `src/main.tsx` (`allowedRedirectOrigins`) |

### Files changed
- `src/lib/native-oauth.ts` *(new)* — opens provider OAuth in the system browser, handles the deep-link callback, completes sign-in or transfers to sign-up.
- `src/components/native-social-buttons.tsx` *(new)* — Apple/Google buttons shown only in the native app.
- `src/lib/clerk-appearance.ts` — added `clerkAppearanceNative` (hides Clerk's in-WebView social buttons).
- `src/pages/signin.tsx`, `src/pages/signup.tsx` — render native buttons + native appearance when running in Capacitor.
- `src/main.tsx` — `allowedRedirectOrigins` for the `vettrack://oauth-callback` scheme.
- `ios/App/App/Info.plist` — registered the `vettrack` URL scheme (`CFBundleURLTypes`).
- `package.json` — added `@capacitor/browser`.

---

## What YOU need to do (Mac-side — I can't run these)

### 1. Install + sync the native plugin

**Critical:** the default `pnpm build && cap sync` bundles the web app into the
iOS shell at `capacitor://localhost`. Without Clerk keys and a remote API origin,
the sign-in screen shows dev-bypass ("כניסה ללוח הבקרה") and `/api/users/me`
returns the local `index.html` — auth never completes.

Pick **one** of these before device testing:

**Option A — remote WebView (simplest for review testing):**
```bash
cd /Users/dan/vettrack
pnpm install
CAPACITOR_SERVER_URL=https://vettrack.uk pnpm cap:sync
```
The app loads production like Safari; Clerk + API work without extra env.

**Option B — bundled shell (App Store archive):**
```bash
cd /Users/dan/vettrack
pnpm install
# .env must include production Clerk publishable key + API host:
#   VITE_CLERK_PUBLISHABLE_KEY=pk_live_…
#   VITE_API_ORIGIN=https://vettrack.uk
pnpm build
npx cap sync ios        # runs pod install for @capacitor/browser
```
Server CORS must allow `capacitor://localhost` (already in `server/index.ts`).
Deploy the API change before testing Option B against production.

### 2. Bump the build number to (4)
In Xcode: **App target → General → Identity → Build = 4** (Version stays 1.0).
Or CLI: `cd ios/App && agvtool new-version -all 4`

### 3. Device-test BEFORE archiving (this is the part that needs a real device)
Run on a physical iPad/iPhone (Sign in with Apple needs real hardware):
- [ ] **Email/password**: sign in as `reviewer@vettrack.uk` / `VetTrack2026!` → lands in the app.
- [ ] **Apple**: tap "Sign in with Apple" → system sheet opens (NOT an error) → returns signed in.
- [ ] **Apple (new account)**: same from the Sign-up screen → creates an account.
- [ ] **Google**: tap "Sign in with Google" → system browser → returns signed in.

If Apple/Google error or hang, capture the Safari/console error and send it to me — the
likely culprits are (a) the redirect scheme not matching, or (b) Clerk rejecting the
redirect URL (see Troubleshooting).

### 4. Promote the reviewer to admin (full feature access — Guideline 2.1)
The app assigns `technician` on first login, which hides admin screens. After the
reviewer account has signed in once (step 3), promote it to `admin`:
- Easiest: sign in to the app as your own admin account → **Admin → Users** →
  set **VetTrack Reviewer** role to **Admin**.
- The reviewer row only exists in the app DB *after* its first sign-in, so do this
  after step 3.

### 5. Archive + upload
Xcode: **Product → Clean Build Folder**, then **Product → Archive → Distribute App →
App Store Connect → Upload**.

### 6. Resubmit in App Store Connect
- Select build **1.0 (4)**.
- App Review Information → confirm demo user `reviewer@vettrack.uk` / `VetTrack2026!`.
- (Optional) In "Notes", mention: "Sign in with Apple/Google now open in the system
  browser; a demo email/password account is provided for full access."
- Submit for review.

---

## Troubleshooting (if Apple/Google sign-in fails on device)

- **Blank white screen on launch (bundled shell)** → Clerk JS failed to load on
  `capacitor://localhost`. In Clerk Dashboard → **Configure → Native applications**,
  allow origin `capacitor://localhost` (and `ionic://localhost`). Rebuild with
  `VITE_CLERK_PUBLISHABLE_KEY` + `VITE_API_ORIGIN=https://vettrack.uk`, or use
  `CAPACITOR_SERVER_URL=https://vettrack.uk pnpm cap:sync` to load the live site in
  the WebView. Safari Web Inspector → refresh once to surface clerk-js errors.
- **"Invalid redirect URL"** from Clerk → in the Clerk Dashboard, add
  `vettrack://oauth-callback` to the allowed redirect URLs (Configure → Paths /
  native settings). The SDK prop in `main.tsx` should cover this, but the dashboard
  allowlist is the fallback.
- **Browser opens but never returns to the app** → the `vettrack` scheme in
  `Info.plist` isn't matching the `OAUTH_REDIRECT_URL` in `src/lib/native-oauth.ts`.
  They must both be `vettrack` / `vettrack://oauth-callback`.
- **Apple sheet shows then closes with no session** → check the `rotating_token_nonce`
  parsing in `native-oauth.ts`; send me the callback URL (with the nonce redacted).

## Rollback
All changes are additive and native-only (`isCapacitorNative()` gated). The web app
is unchanged. To revert 2.1a, `git checkout` the files listed above.
