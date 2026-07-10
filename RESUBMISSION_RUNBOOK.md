# VetTrack — App Store Resubmission Runbook (A–Z)

**Audience:** a future Claude session (or Dan) executing the resubmission cold.
**Goal:** ship an App Store **update** to the live VetTrack app.
> **Historical origin (resolved):** this runbook was first written to clear the **5.1.1(v)** rejection of build 15 and land **1.0.1 (20)** — submission `a0758d36-14b9-49c0-bf20-eb337ffcb8c6`. That rejection is **resolved and the app is LIVE**, so every run of this runbook is now an update / re-upload, not a first submission.
**Current version fields:** marketing **1.1.2** (`package.json` = source of truth), build **25** (`CURRENT_PROJECT_VERSION`; `ios/.last-shipped-build` records the last build uploaded). Bump only via `pnpm resubmit` (§B.1) — never by hand.
**Last verified:** 2026-07-10, version fields single-sourced + reconciled to 1.1.2 / build 25 (tooling in §B.1); production includes account deletion + native Apple token link.

> Secrets: this file never contains the live Clerk key. Export it from Railway first:
> `export CLERK_SECRET_KEY=$(cd /Users/dan/.vt-deploy 2>/dev/null && railway variables --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['CLERK_SECRET_KEY'])")`
> or copy `CLERK_SECRET_KEY` from Railway → project `pacific-flow` → service `VetTrack` → Variables.

---

## A. The three rejection items (and that they are fixed)

| Guideline | Apple's finding | Root cause | Fix (verified) |
|---|---|---|---|
| **2.3.8** | Placeholder app icons | Default Capacitor icon shipped | Single universal **1024×1024** VT brand icon, **alpha-stripped** (`hasAlpha: no`) at `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` |
| **2.1(a)** | Error registering a new account with Apple | In-WebView Clerk OAuth + a chain of 5 deeper causes (see §F) | System-browser OAuth + native Clerk transport. Apple **and** Google device-confirmed |
| **2.1** | Demo account login failed | Clerk **Client Trust** challenged the password login on a new device (no MFA → email-code wall the reviewer couldn't pass); also wrong password on the account | Client Trust reverted; password set via Backend API; account promoted to admin + English locale |
| **5.1.1(v)** | In-app account deletion required (Sign in with Apple) | No delete flow; Apple token revocation not wired | Settings → Danger zone → Delete account; native Apple `authorizationCode` linked after sign-in; demo account protected from self-deletion |

## B. Current state (what is already done)

- **Code:** account deletion + Playwright CI fixes merged to `github/main` (PR #1). Local `main` synced. Deploy to Railway before App Review (§K).
- **Production web** (`https://vettrack.uk`): serving the current bundle. The iOS shell is a **bundled app** (no `server.url`) — it does NOT depend on production for the frontend, but the API + Clerk it calls are production.
- **Clerk (production instance `clerk.vettrack.uk`):** redirect URLs, allowed origins, Apple+Google OAuth, demo account, Client Trust — all configured (verify in §C).
- **Version:** the app is **LIVE on the App Store**, so every submission is an update. Version fields are single-sourced (`package.json` = the marketing version of record = **1.1.2**; iOS `MARKETING_VERSION` reconciled to match; `CURRENT_PROJECT_VERSION` = **25**; `Info.plist CFBundleVersion` = `$(CURRENT_PROJECT_VERSION)`, no literal). **Do not hand-edit version fields — use `pnpm resubmit` / `pnpm resubmit:release` (§B.1).**
- **Synced shell:** `npx cap sync ios` already run from HEAD. `dist/public` == `ios/App/App/public`.
- **Legal pages:** `/privacy`, `/terms`, and `/support` are implemented — verify all three on production after deploy before setting App Store / Play Console URLs. See `docs/legal-pages.md`.

## B.1. Version bump — one command (`scripts/resubmit.sh`)

The app is live, so bump before every archive. `resubmit.sh` single-sources the
version across `package.json`, the pbxproj (`CURRENT_PROJECT_VERSION` +
`MARKETING_VERSION`), and `Info.plist` (`CFBundleVersion = $(CURRENT_PROJECT_VERSION)`),
then runs the §C verification. It edits version fields only — no app logic.

- **Same version, new binary** (App Store re-upload / fix a rejected build):
  ```bash
  pnpm resubmit            # build n -> n+1; marketing version unchanged
  ```
- **New product version** (new work shipped — you pick patch/minor/major; reserve
  major for releases that warrant it, no auto-increment):
  ```bash
  pnpm resubmit:release 1.2.0     # sets marketing 1.2.0 + seeds build n+1
  ```

Then `pnpm cap:build:native` and archive (§C/§D). After a **successful** App Store
upload, record the shipped build so the next bump is validated against it:
```bash
echo <that build number> > ios/.last-shipped-build
```
The §C build-number gate fails until the current build exceeds `ios/.last-shipped-build`
(override for a one-off with `LAST_SHIPPED_BUILD=<n>`). Native builds still go only
through `scripts/build-native-shell.sh`; the archive/upload is human-run (§D).

## C. PRE-ARCHIVE VERIFICATION — run these every time before archiving

State drifts (especially Clerk Client Trust). Re-run all of this and require every line to pass. Needs `CLERK_SECRET_KEY` exported (see top).

```bash
cd /Users/dan/vettrack
SK="$CLERK_SECRET_KEY"

# [2.1] Demo login must COMPLETE (this is the #1 re-rejection risk)
# First: export REVIEWER_PASSWORD='…'  (from your password manager — never commit it)
curl -s -D /tmp/h.txt -X POST "https://clerk.vettrack.uk/v1/client/sign_ins?_is_native=1&_clerk_js_version=5.125.13" \
  -H "Origin: capacitor://localhost" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "identifier=reviewer@vettrack.uk" -o /tmp/si.json
JWT=$(grep -i "^authorization:" /tmp/h.txt | cut -d' ' -f2 | tr -d '\r')
SID=$(python3 -c "import json;print(json.load(open('/tmp/si.json'))['response']['id'])")
curl -s -X POST "https://clerk.vettrack.uk/v1/client/sign_ins/${SID}/attempt_first_factor?_is_native=1" \
  -H "Origin: capacitor://localhost" -H "Authorization: ${JWT}" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "strategy=password" --data-urlencode "password=$REVIEWER_PASSWORD" \
  | python3 -c "import json,sys;r=json.load(sys.stdin).get('response',{});print('LOGIN:', r.get('status'))"
#   EXPECT: LOGIN: complete   (if 'needs_client_trust' → Client Trust is back ON, see §G)

# [2.1a] Clerk config gating Apple sign-up
curl -s https://api.clerk.com/v1/redirect_urls -H "Authorization: Bearer $SK" \
  | python3 -c "import json,sys;u=[r['url'] for r in json.load(sys.stdin)];print('REDIRECT vettrack scheme:', 'vettrack://oauth-callback' in u)"
#   EXPECT: True
curl -s https://api.clerk.com/v1/instance -H "Authorization: Bearer $SK" \
  | python3 -c "import json,sys;o=json.load(sys.stdin).get('allowed_origins') or [];print('ORIGINS capacitor:', 'capacitor://localhost' in o)"
#   EXPECT: True

# [2.3.8] Icon: alpha-stripped, 1024, brand (not placeholder)
sips -g hasAlpha -g pixelWidth ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png | tail -2
#   EXPECT: hasAlpha: no   pixelWidth: 1024

# Build number must be STRICTLY GREATER than the last shipped build (the app is
# live — App Store Connect rejects a duplicate CFBundleVersion within a version).
# verify-resubmission.sh checks CURRENT_PROJECT_VERSION > ios/.last-shipped-build.
grep -m1 CURRENT_PROJECT_VERSION ios/App/App.xcodeproj/project.pbxproj
#   EXPECT: CURRENT_PROJECT_VERSION greater than $(cat ios/.last-shipped-build)
#   (currently pbxproj=25 and last-shipped=25 → run `pnpm resubmit` to bump to 26 first)

# Shell is a BUNDLED app (no server.url) and carries the native OAuth transport
python3 -c "import json;c=json.load(open('ios/App/App/capacitor.config.json'));print('BUNDLED:', 'server' not in c or not c.get('server',{}).get('url'))"
ls ios/App/App/public/assets/clerk-native-instance-*.js >/dev/null 2>&1 && echo "NATIVE CLERK CHUNK: present"
#   EXPECT: BUNDLED: True  /  NATIVE CLERK CHUNK: present
```

If you changed any frontend code, rebuild + re-sync BEFORE archiving. Use the **ship worktree**
(`/Users/dan/vettrack-ship`, clean tree only) — not the dev lane if it has uncommitted WIP:

```bash
cd /Users/dan/vettrack
./scripts/archive-from-clean-tree.sh
# Refuses dirty dev/ship trees → verify 16/16 → build-native-shell in vettrack-ship.
# Flags: --skip-build (verify only) | --sim-smoke | --fetch
```

Manual fallback (ship lane only):
```bash
cd /Users/dan/vettrack-ship && git status   # must be clean
REPO=$PWD ./scripts/verify-resubmission.sh
REPO=$PWD ./scripts/build-native-shell.sh
# Reads VITE_CLERK_PUBLISHABLE_KEY + VITE_API_ORIGIN from .env only (.env.local is ignored).
# NEVER pass CAPACITOR_SERVER_URL — that makes a thin web wrapper (4.2 risk + OAuth breaks).
```

Simulator smoke before archive:
```bash
./scripts/install-ios-sim.sh
```

## D. Archive in Xcode (the part only a human can do)

1. `npx cap open ios` (or open `ios/App/App.xcworkspace`).
2. Select **Any iOS Device (arm64)** as the destination.
3. **Product → Clean Build Folder**.
4. **Product → Archive**. Wait for the Organizer.
5. In Organizer: **Distribute App → App Store Connect → Upload** → use automatic signing → Upload.
6. Wait for the build to finish processing in App Store Connect (email confirmation, ~10–30 min).

## E. Resubmit in App Store Connect

1. Open the app → the current marketing version (**1.1.2**), or create the new version if you ran `pnpm resubmit:release <target>`.
2. **Build** → select the freshly uploaded build — the `build=<n> marketing=<v>` values `pnpm resubmit` printed (e.g. **1.1.2 (26)**).
3. **App Review Information**:
   - Sign-In required: **Yes**.
   - Username: `reviewer@vettrack.uk`  Password: *(from your password manager — paste it into this App Store Connect field; never commit it to the repo)*
   - Notes: *"Sign in with Apple/Google open in the system browser per Apple's guidelines. A demo email/password account with full admin access is provided above. The demo account cannot be deleted (protected for review). To test account deletion, sign in with a personal Apple ID, then Settings → Danger zone → Delete account. The app is a native Capacitor app; all features work offline-capable."*
4. **Confirm Client Trust is permanently off** (§G) before submitting.
5. **Add for Review → Submit**.

## F. Why 2.1(a) needed six fixes (do NOT undo any of these)

The Apple-sign-up error had a stack of causes, each hiding the next. All are load-bearing:
1. `1c52f248` — system-browser OAuth (`src/lib/native-oauth.ts`) — Apple/Google block OAuth in a WebView.
2. `c288691a` + `7cea97f0` — bundled-shell auth + **CORS for `capacitor://localhost`** (raw-origin match: `new URL("capacitor://localhost").origin === "null"`, so the allowlist must match the raw header).
3. `ff218fef` — `standardBrowser: false` (clerk-js native mode).
4. `76b1eeeb` — **native FAPI transport**: `_is_native=1` + client JWT in the `Authorization` header (cookie mode can't complete a system-browser callback — this was THE root fix; `clerk-native-instance.ts`).
5. `4f7bff28` — `allowedRedirectProtocols: ["capacitor:","vettrack:"]` — without it clerk-js's session-sync navigation rejects `capacitor:` and the WebView **reload-loops** on every boot with a stored session.
6. Clerk dashboard/API: redirect URL `vettrack://oauth-callback` allowlisted, instance `allowed_origins` includes `capacitor://localhost`.

## G. Residual risks & how to handle

- **Client Trust re-enabling (HIGH — this is what to watch).** It was disabled via the dashboard's *24-hour "Revert update"*. If it turns back on, demo login fails again (`needs_client_trust`). Before each submission: run the §C login check (must say `complete`), and in **Clerk → Configure → Updates** confirm "Client Trust" is reverted, not on a timer. Durable option: leave it off for this instance; the in-app `needs_client_trust` email-code handler is NOT a fix here because the reviewer can't read the demo mailbox.
- **Unpushed commits (MEDIUM).** Local-only commits must be pushed before any CI deploy to `origin/main`, or production may regress. **Push `main` to origin before any CI deploy.**
- **Direct-deploy drift.** Production is updated by `railway up` from `/Users/dan/.vt-deploy`, not CI. The Railway MCP token may be expired; use the **CLI** (`railway up --detach`, run from a plain dir — do NOT pass `.` as the path arg, it errors with "prefix not found" on CLI 5.5.0).

## H. Troubleshooting (failure → fix, all seen before)

- **`authorization_invalid` on Apple sign-in** → a native-transport piece is missing. Re-verify §F items 3–6. If the `clerk_trace_id` repeats across attempts, it's a stale error page, not a new failure.
- **App boots and reload-loops ("jumping page")** → `allowedRedirectProtocols` missing `capacitor:` (§F#5).
- **Blank/white screen at launch** → clerk-js failed to load; check `capacitor://localhost` is in Clerk `allowed_origins`; NativeClerkGate should show a visible error instead of blank.
- **Demo login button does nothing / "Too many requests"** → FAPI 429 from rapid retries (wait ~3 min) OR `needs_client_trust` (Client Trust back on, §G).
- **Reviewer lands without admin features** → confirm `vt_users.role = admin` and `preferred_locale = en` for the reviewer (set via Backend API / DB earlier; promote again if a fresh sign-in reset it).

## I. Do NOT change (frozen for App Review)

- `capacitor.config.ts` bundled mode (no `server.url`) for the shipped archive.
- Clerk: redirect URLs, `allowed_origins`, Apple/Google OAuth, Client Trust OFF.
- The native-OAuth chain in §F.
- Build number is monotonic — bump for each new upload via `pnpm resubmit` (§B.1), never by hand. It must exceed `ios/.last-shipped-build`.

## J. After acceptance

- Push local commits to `origin` before deploy: `git push origin main`.
- Fix the Railway Worker start command permanently in the dashboard (Custom Start Command = `pnpm worker`) and correct the `NODE_ENV` variable (currently the literal string `PORT 8080`; should be `production`).
- Deferred UX items (not App-Review-blocking): Tasks-page card spacing (needs populated-data repro) and the Shift-Chat keyboard/bottom-sheet issue (needs device repro; likely add `@capacitor/keyboard`).

## K. Account deletion + Apple revocation (Guideline 5.1.1(v))

Full spec: [`docs/account-deletion.md`](docs/account-deletion.md).

### Railway variables (required for Apple token revocation)

Set on service **VetTrack** in project `pacific-flow` (all four required; `DB_CONFIG_ENCRYPTION_KEY` already present):

| Variable | Value |
|---|---|
| `APPLE_TEAM_ID` | 10-char Apple Team ID |
| `APPLE_KEY_ID` | Sign in with Apple key ID |
| `APPLE_CLIENT_ID` | `uk.vettrack.app` (bundle ID — matches native authorization code) |
| `APPLE_PRIVATE_KEY` | `.p8` contents (use `\n` for newlines in Railway UI) |

After setting vars, redeploy. Migration `155_apple_oauth_tokens` runs at startup.

### Pre-submit checks

```bash
# Demo account must NOT be deletable (403 ACCOUNT_DELETION_PROTECTED)
curl -s -o /dev/null -w "%{http_code}" -X DELETE "https://vettrack.uk/api/users/delete-account" \
  -H "Authorization: Bearer <reviewer-session-jwt>"
# EXPECT: 403
```

### App Review screen recording (deletion path)

Record **one continuous video** with a **personal** Apple ID (not `reviewer@vettrack.uk`):

1. Sign in with Apple (native system browser flow).
2. Settings → **Danger zone** → **Delete account**.
3. Type `DELETE` / `מחק` → confirm → success toast → signed out.

Attach the recording in App Review notes with the navigation steps above.

### Native shell rebuild (when account-deletion or Apple-link code changes)

```bash
cd /Users/dan/vettrack
pnpm install
npx cap sync ios
./scripts/build-native-shell.sh
./scripts/install-ios-sim.sh   # optional smoke
```

Then archive in Xcode (§D) with an incremented build number.
