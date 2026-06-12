# VetTrack — App Store Resubmission Runbook (A–Z)

**Audience:** a future Claude session (or Dan) executing the resubmission cold.
**Goal:** get VetTrack **1.0 (4)** through App Review after the 1.0 (3) rejection
(Submission `9f5acacc-9abd-449c-b297-1834d568a84b`).
**Last verified:** 2026-06-12, production build `dffa7385` (buildTag `1.1.2-mqarwzsp`).

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

## B. Current state (what is already done)

- **Code:** all fixes are committed locally on `main`. **16 commits are unpushed** (`1c52f248` … `dffa7385`) because GitLab access is blocked. Production runs them via **direct Railway deploy**, NOT CI.
- **Production web** (`https://vettrack.uk`): serving the current bundle. The iOS shell is a **bundled app** (no `server.url`) — it does NOT depend on production for the frontend, but the API + Clerk it calls are production.
- **Clerk (production instance `clerk.vettrack.uk`):** redirect URLs, allowed origins, Apple+Google OAuth, demo account, Client Trust — all configured (verify in §C).
- **Build number:** `CURRENT_PROJECT_VERSION = 4`, `MARKETING_VERSION = 1.0`. Ready to archive as **1.0 (4)**.
- **Synced shell:** `npx cap sync ios` already run from HEAD. `dist/public` == `ios/App/App/public`.

## C. PRE-ARCHIVE VERIFICATION — run these every time before archiving

State drifts (especially Clerk Client Trust). Re-run all of this and require every line to pass. Needs `CLERK_SECRET_KEY` exported (see top).

```bash
cd /Users/dan/vettrack
SK="$CLERK_SECRET_KEY"

# [2.1] Demo login must COMPLETE (this is the #1 re-rejection risk)
curl -s -D /tmp/h.txt -X POST "https://clerk.vettrack.uk/v1/client/sign_ins?_is_native=1&_clerk_js_version=5.125.13" \
  -H "Origin: capacitor://localhost" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "identifier=reviewer@vettrack.uk" -o /tmp/si.json
JWT=$(grep -i "^authorization:" /tmp/h.txt | cut -d' ' -f2 | tr -d '\r')
SID=$(python3 -c "import json;print(json.load(open('/tmp/si.json'))['response']['id'])")
curl -s -X POST "https://clerk.vettrack.uk/v1/client/sign_ins/${SID}/attempt_first_factor?_is_native=1" \
  -H "Origin: capacitor://localhost" -H "Authorization: ${JWT}" -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "strategy=password" --data-urlencode "password=VetTrack2026!" \
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

# Build number must be >= 4
grep -m1 CURRENT_PROJECT_VERSION ios/App/App.xcodeproj/project.pbxproj
#   EXPECT: CURRENT_PROJECT_VERSION = 4

# Shell is a BUNDLED app (no server.url) and carries the native OAuth transport
python3 -c "import json;c=json.load(open('ios/App/App/capacitor.config.json'));print('BUNDLED:', 'server' not in c or not c.get('server',{}).get('url'))"
ls ios/App/App/public/assets/clerk-native-instance-*.js >/dev/null 2>&1 && echo "NATIVE CLERK CHUNK: present"
#   EXPECT: BUNDLED: True  /  NATIVE CLERK CHUNK: present
```

If you changed any frontend code, rebuild + re-sync BEFORE archiving:
```bash
cd /Users/dan/vettrack
# .env must hold prod VITE_CLERK_PUBLISHABLE_KEY (pk_live_…) + VITE_API_ORIGIN=https://vettrack.uk
pnpm build
env -u CAPACITOR_SERVER_URL npx cap sync ios   # NEVER pass CAPACITOR_SERVER_URL — that makes a thin web wrapper (4.2 risk + OAuth breaks)
```

## D. Archive in Xcode (the part only a human can do)

1. `npx cap open ios` (or open `ios/App/App.xcworkspace`).
2. Select **Any iOS Device (arm64)** as the destination.
3. **Product → Clean Build Folder**.
4. **Product → Archive**. Wait for the Organizer.
5. In Organizer: **Distribute App → App Store Connect → Upload** → use automatic signing → Upload.
6. Wait for the build to finish processing in App Store Connect (email confirmation, ~10–30 min).

## E. Resubmit in App Store Connect

1. Open the app → the **1.0** version (or create version 1.0 if needed).
2. **Build** → select the freshly uploaded **1.0 (4)**.
3. **App Review Information**:
   - Sign-In required: **Yes**.
   - Username: `reviewer@vettrack.uk`  Password: `VetTrack2026!`
   - Notes: *"Sign in with Apple/Google open in the system browser per Apple's guidelines. A demo email/password account with full admin access is provided above. The app is a native Capacitor app; all features work offline-capable."*
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
- **Unpushed commits (MEDIUM).** 16 commits are local-only. If GitLab access returns and CI deploys `origin/main`, production **regresses** to pre-fix code and breaks the live app the reviewer hits. **Push `main` to origin before any CI deploy.**
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
- Build number stays ≥ 4 (bump for each new upload: `cd ios/App && agvtool new-version -all 5`).

## J. After acceptance

- Push the 16 commits to origin the moment GitLab unblocks (`git push origin main`).
- Fix the Railway Worker start command permanently in the dashboard (Custom Start Command = `pnpm worker`) and correct the `NODE_ENV` variable (currently the literal string `PORT 8080`; should be `production`).
- Deferred UX items (not App-Review-blocking): Tasks-page card spacing (needs populated-data repro) and the Shift-Chat keyboard/bottom-sheet issue (needs device repro; likely add `@capacitor/keyboard`).
