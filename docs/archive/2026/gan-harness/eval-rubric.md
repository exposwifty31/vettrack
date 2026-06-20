# Evaluation Rubric: VetTrack iOS Resubmission (1.0.1)

> Evaluator-consumable rubric for the GAN harness. This is a **ship/resubmission** rubric, not a
> generic app-quality rubric. Score = Σ(category_score × weight). Each check is **mechanical** where
> possible (script exit code, grep pattern, file existence, curl). Human-only checks are marked `[H]`.
>
> Paths assume the **ship lane** `/Users/dan/vettrack-ship` for archive-bound checks and
> `/Users/dan/vettrack` for dev-lane checks. Export `CLERK_SECRET_KEY` before live gates.
>
> **Hard gate:** if any check tagged `BLOCKER` fails, total score is capped at 0.4 ("DO NOT ARCHIVE").

---

## Category 1 — Ship lane discipline (weight: 0.25)

| # | Check | How (mechanical) | Pass condition |
|---|-------|------------------|----------------|
| 1.1 `BLOCKER` | Ship worktree exists on `main` | `git -C /Users/dan/vettrack-ship rev-parse --abbrev-ref HEAD` | prints `main` |
| 1.2 `BLOCKER` | Ship tree is clean | `git -C /Users/dan/vettrack-ship status --porcelain` | empty output |
| 1.3 `BLOCKER` | Dev WIP committed before bundle | `git -C /Users/dan/vettrack status --porcelain` | empty (no uncommitted native-auth WIP) |
| 1.4 | Ship not behind origin | `git -C /Users/dan/vettrack-ship log origin/main..main --oneline` | empty OR commits intentionally pushed |
| 1.5 `BLOCKER` | No debug instrumentation in bundle source | `rg -n "127\.0\.0\.1:7630|#region agent log" /Users/dan/vettrack-ship/src /Users/dan/vettrack-ship/server` | no matches |
| 1.6 | No duplicated ship source | `ls /Users/dan/vettrack-ship/src-ship 2>/dev/null; rg -l "signin-ship" /Users/dan/vettrack-ship/src` | absent / no matches |
| 1.7 | No `server.url` in capacitor config | `python3 -c "import json;c=json.load(open('/Users/dan/vettrack-ship/ios/App/App/capacitor.config.json'));print('server' not in c or not c.get('server',{}).get('url'))"` | `True` |
| 1.8 | No `CAPACITOR_SERVER_URL` set in build env | inspect shell env / `.env` of ship lane | unset / absent |

**Scoring:** 1.0 if all pass; subtract 0.15 per non-BLOCKER fail. Any BLOCKER fail → category 0 + hard cap.

---

## Category 2 — Auth / resubmission gates (weight: 0.35)

| # | Check | How (mechanical) | Pass condition |
|---|-------|------------------|----------------|
| 2.1 `BLOCKER` | 16-gate verify passes | `cd /Users/dan/vettrack-ship && REPO=$PWD ./scripts/verify-resubmission.sh; echo "exit=$?"` | exit=0 and "ALL GATES PASS" |
| 2.2 `BLOCKER` | Demo login `complete` | RESUBMISSION_RUNBOOK §C demo-login curl (or verify script `[2.1]` line) | `LOGIN: complete` (NOT `needs_client_trust`) |
| 2.3 | Redirect URL allowlisted | `curl -s https://api.clerk.com/v1/redirect_urls -H "Authorization: Bearer $SK"` | contains `vettrack://oauth-callback` |
| 2.4 | Allowed origins include capacitor | `curl -s https://api.clerk.com/v1/instance -H "Authorization: Bearer $SK"` | `allowed_origins` ∋ `capacitor://localhost` |
| 2.5 | API CORS for shell | `curl -sSI -H "Origin: capacitor://localhost" https://vettrack.uk/api/version` | ACAO = `capacitor://localhost` |
| 2.6 `BLOCKER` | Six §F native-OAuth fixes intact | grep ship src (see §F-checks below) | all present |
| 2.7 `BLOCKER` | Session-vs-client JWT separation present | `ls /Users/dan/vettrack-ship/src/lib/native-clerk-session-token.ts && rg -n "isClerkSessionJwt|CLERK_CLIENT_JWT_STORAGE_KEY" /Users/dan/vettrack-ship/src/lib/native-clerk-session-token.ts` | file exists, both symbols present |
| 2.8 | pk_live + API origin baked | verify script `[native bundle auth]` block | `pk_live` and `https://vettrack.uk` in `index-*.js` |
| 2.9 | signin chunk is real Clerk UI | `wc -c < $(ls /Users/dan/vettrack-ship/ios/App/App/public/assets/signin-*.js)` | > 8000 bytes |
| 2.10 | tsc clean on touched code | `cd /Users/dan/vettrack && npx tsc --noEmit; echo exit=$?` | exit=0 |
| 2.11 | Native auth tests pass | `cd /Users/dan/vettrack && pnpm test -- tests/native-clerk-session-token.test.ts tests/native-apple-link.test.ts tests/clerk-authorized-parties.test.ts` | all pass |

### §F native-OAuth chain checks (for 2.6 — all must pass)
```
rg -n "startNativeOAuth"            /Users/dan/vettrack-ship/src/lib/native-oauth.ts        # system-browser OAuth (§F#1)
rg -n "_is_native"                  /Users/dan/vettrack-ship/src                            # native FAPI transport (§F#4)
rg -n "standardBrowser"            /Users/dan/vettrack-ship/src                            # clerk-js native mode (§F#3)
rg -n "allowedRedirectProtocols"   /Users/dan/vettrack-ship/src                            # capacitor:/vettrack: (§F#5)
rg -n "capacitor://localhost"      /Users/dan/vettrack-ship/server                         # raw-origin CORS (§F#2)
```
Each must return ≥1 match. Missing `allowedRedirectProtocols` = reload-loop regression (BLOCKER).

**Scoring:** 1.0 if all pass; subtract 0.1 per non-BLOCKER fail. Any BLOCKER fail → category 0 + hard cap.

---

## Category 3 — Apple guideline compliance (weight: 0.25)

| # | Guideline | Check | How | Pass condition |
|---|-----------|-------|-----|----------------|
| 3.1 `BLOCKER` | 2.3.8 | Icon alpha-stripped 1024 | `sips -g hasAlpha -g pixelWidth /Users/dan/vettrack-ship/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | `hasAlpha: no` and `pixelWidth: 1024` |
| 3.2 | — | Build number ≥ 4 | `grep -m1 CURRENT_PROJECT_VERSION /Users/dan/vettrack-ship/ios/App/App.xcodeproj/project.pbxproj` | `= 20` (or higher, ≥4) |
| 3.3 `BLOCKER` | 5.1.1(v) | Demo account NOT deletable | `curl -s -o /dev/null -w "%{http_code}" -X DELETE https://vettrack.uk/api/users/delete-account -H "Authorization: Bearer <reviewer-jwt>"` | `403` |
| 3.4 | 5.1.1(v) | Deletion flow exists in UI | `rg -ni "delete account|danger zone" /Users/dan/vettrack-ship/src/pages/settings*.tsx /Users/dan/vettrack-ship/src` | matches in settings/danger-zone |
| 3.5 | 5.1.1(v) | Apple revocation wired | `rg -n "APPLE_CLIENT_ID\|apple.*revoke\|authorizationCode" /Users/dan/vettrack-ship/server` + Railway vars set | revocation path present; 4 Apple vars set |
| 3.6 | 5.1.1(v) | Deletion screen recording attached | `[H]` App Store Connect review notes | continuous personal-Apple-ID video attached |
| 3.7 | — | Legal pages live | `for p in privacy terms support; do curl -s -o /dev/null -w "%{http_code} " https://vettrack.uk/$p; done` | all `200` |
| 3.8 | 2.1 | Reviewer notes complete | `[H]` ASC App Review Information | demo creds + system-browser OAuth + deletion steps present |
| 3.9 | — | AASA + entitlements | verify script `[AASA + entitlements]` block | appID `87F5G378M6.uk.vettrack.app` + `applinks:vettrack.uk` |

**Scoring:** 1.0 if all pass; subtract 0.12 per non-BLOCKER fail. Any BLOCKER fail → category 0 + hard cap.

---

## Category 4 — Native UX polish (weight: 0.15)

| # | Check | How | Pass condition |
|---|-------|-----|----------------|
| 4.1 | Boots to `/signin` with live Clerk card | `[H]/sim` `REPO=/Users/dan/vettrack-ship ./scripts/install-ios-sim.sh` | app launches, `/signin`, Apple/Google/demo + "Secured by Clerk" |
| 4.2 | No white/blank screen at launch | sim smoke + NativeClerkGate visible-error path | content renders (not blank) |
| 4.3 | No reload loop ("jumping page") | sim smoke with stored session | stable; `allowedRedirectProtocols` present (cross-ref 2.6) |
| 4.4 | `VetTrackMark` branding renders | `ls /Users/dan/vettrack-ship/src/components/vettrack-mark.tsx && rg -n "VetTrackMark" /Users/dan/vettrack-ship/src/pages/signin.tsx` | file exists + referenced on sign-in |
| 4.5 | Badge AA contrast retained | `rg -n "bg-red-700" /Users/dan/vettrack-ship/src/components/alerts-dropdown.tsx /Users/dan/vettrack-ship/src/features/shift-chat/components/ShiftChatFab.tsx` | `bg-red-700` (not `bg-red-500`) |
| 4.6 | No Hebrew hardcoded in source | `cd /Users/dan/vettrack-ship && pnpm test -- tests/i18n-no-hebrew-in-source.test.ts` | passes |

**Scoring:** 1.0 if all pass; subtract 0.17 per fail. (No BLOCKERs here, but 4.1–4.3 failing strongly
signals a broken archive — flag prominently.)

---

## Aggregate scoring

```
total = 0.25*cat1 + 0.35*cat2 + 0.25*cat3 + 0.15*cat4
```

| Verdict | Condition |
|---------|-----------|
| **SHIP** | total ≥ 0.9 AND zero BLOCKER fails |
| **FIX-FIRST** | 0.7 ≤ total < 0.9 OR any non-cat-4 weakness |
| **DO NOT ARCHIVE** | total < 0.7 OR any BLOCKER fail (hard cap 0.4) |

## Evaluator quick-run (one block)
```bash
export REPO=/Users/dan/vettrack-ship
export CLERK_SECRET_KEY=...   # from Railway (see RESUBMISSION_RUNBOOK top)
git -C "$REPO" status --porcelain                      # 1.2 must be empty
git -C /Users/dan/vettrack status --porcelain          # 1.3 must be empty
cd "$REPO" && REPO=$PWD ./scripts/verify-resubmission.sh; echo "verify exit=$?"   # 2.1
rg -n "isClerkSessionJwt" "$REPO/src/lib/native-clerk-session-token.ts"           # 2.7
rg -n "allowedRedirectProtocols" "$REPO/src"                                       # 2.6 (BLOCKER if empty)
sips -g hasAlpha -g pixelWidth "$REPO/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"  # 3.1
for p in privacy terms support; do curl -s -o /dev/null -w "%{http_code} " https://vettrack.uk/$p; done; echo   # 3.7
```
