# Evaluation — Iteration 002 (VetTrack iOS 1.0.1 Resubmission)

**Eval mode:** code-only (mechanical ship gates). **Evaluator stance:** ruthless ship-readiness.
**Commit under test:** `13444998` (`main`, ship lane `/Users/dan/vettrack-ship`). **Date:** 2026-06-18.
**Clerk key used:** `sk_live` (line 6 of dev `.env`; value never printed). Iteration-1 false-FAILs on 2.3/2.4 were caused by the `sk_test` key (line 4) targeting a different instance — confirmed.

---

## Scores

| Category | Weight | Raw score | Weighted |
|----------|--------|-----------|----------|
| 1 — Ship lane discipline | 0.25 | 1.00 | 0.2500 |
| 2 — Auth / resubmission gates | 0.35 | 1.00 | 0.3500 |
| 3 — Apple guideline compliance | 0.25 | 0.90 | 0.2250 |
| 4 — Native UX polish | 0.15 | 0.83 | 0.1245 |
| **TOTAL** | | | **0.9495** |
| **Hard cap** | | | none (zero BLOCKER fails) |

### Weighted total: **0.95 / 1.0  →  9.5 / 10**

> `total = 0.25·1.00 + 0.35·1.00 + 0.25·0.90 + 0.15·0.83 = 0.9495`. **No BLOCKER fails → no hard cap.**

## Verdict: **SHIP** (≥ 0.90 AND zero BLOCKER fails)

The archive pipeline that was missing in iteration 1 is now real and verified: the native bundle is
built into the ship worktree, all 16 verify gates pass (exit 0), the two live-Clerk gates pass against
the **production** instance, and `main` is reconciled with `origin/main`. The only remaining gates are
genuinely human-only: the Xcode archive, the App Store Connect reviewer notes/recording, the 4 Railway
Apple vars, and a booted-simulator UX smoke. None are code-verifiable and none block the archive.

---

## Score progression vs. iteration 1

| | Iter 1 | Iter 2 | Δ |
|---|--------|--------|---|
| Cat 1 — ship lane | 0.85 | **1.00** | +0.15 (1.4 main reconciled) |
| Cat 2 — auth gates | **0.00** (BLOCKER 2.1 fail) | **1.00** | +1.00 (bundle built + live Clerk) |
| Cat 3 — Apple guideline | 0.90 | 0.90 | 0.00 (same [H]/live carve-outs) |
| Cat 4 — native UX | 0.66 | 0.83 | +0.17 (bundle now exists; not a broken archive) |
| **Total (capped)** | **0.40** | **0.95** | **+0.55** |
| Verdict | DO NOT ARCHIVE | **SHIP** | — |

---

## Generator claims — independently verified

| Claim | Verdict | Evidence |
|-------|---------|----------|
| `verify-resubmission.sh` exits 0 (16/16 PASS) | **TRUE** | Ran from ship lane with `sk_live`: `PASS: 16  FAIL: 0  ✅ ALL GATES PASS`, `exit=0` |
| Bundle built in ship lane | **TRUE** | `ios/App/App/public/assets/*` built 02:13; `index-*.js` (pk_live + 8× `https://vettrack.uk`), `signin-BYAQRsBR.js` = 15684 B, `clerk-native-instance-D8EAB_7u.js` present; `capacitor.config.json` has no `server.url`; all artifacts gitignored (ship porcelain empty) |
| Clerk config correct (sk_live) | **TRUE** | Live `GET /v1/redirect_urls` ∋ `vettrack://oauth-callback` (5 urls); `GET /v1/instance` `allowed_origins` ∋ `capacitor://localhost` (`[www.vettrack.uk, capacitor://localhost, ionic://localhost, vettrack.uk]`) |
| `main` reconciled with origin (`merge -s ours`) | **TRUE** | Merge `13444998` parents = `ac25a23f` + `8604fd78`(=origin/main); `git merge-base --is-ancestor origin/main main` → YES; `git log main..origin/main` empty (no longer behind) |

---

## Per-check evidence

### Category 1 — Ship lane discipline → **1.00** (all pass)

| # | Result | Evidence |
|---|--------|----------|
| 1.1 `BLOCKER` ship on `main` | **PASS** | `rev-parse --abbrev-ref HEAD` → `main` |
| 1.2 `BLOCKER` ship clean | **PASS** | `status --porcelain` → empty |
| 1.3 `BLOCKER` dev clean | **PASS** | dev porcelain → only `?? gan-harness/` (harness scratch, no native-auth WIP) |
| 1.4 ship not behind origin | **PASS** (was FAIL) | `main..origin/main` empty; `origin/main` (`8604fd78`) is now an ancestor of `main`; `main` strictly ahead by 10 — intentional reconciliation |
| 1.5 `BLOCKER` no debug instrumentation | **PASS** | `rg "127.0.0.1:7630\|#region agent log"` ship src/server → 0 matches |
| 1.6 no duplicated ship source | **PASS** | `src-ship` absent; no `signin-ship` matches |
| 1.7 no `server.url` baked | **PASS** | `capacitor.config.json` → `no_server_url=True` |
| 1.8 no `CAPACITOR_SERVER_URL` | **PASS** | ship `.env` (374 B, gitignored) does not set it |

Scoring: all pass → **1.00**.

### Category 2 — Auth / resubmission gates → **1.00** (all pass)

| # | Result | Evidence |
|---|--------|----------|
| 2.1 `BLOCKER` verify passes | **PASS** (was FAIL) | `PASS: 16  FAIL: 0`, `exit=0`, "✅ ALL GATES PASS" |
| 2.2 `BLOCKER` demo login complete | **PASS** | verify `[2.1] login status = complete` |
| 2.3 redirect URL allowlisted | **PASS** (was FAIL) | live `vettrack://oauth-callback present = True` |
| 2.4 allowed origins capacitor | **PASS** (was FAIL) | live `capacitor://localhost present = True` |
| 2.5 API CORS for shell | **PASS** | `/api/version` `access-control-allow-origin: capacitor://localhost` |
| 2.6 `BLOCKER` six §F fixes | **PASS** | F#1 `startNativeOAuth` (native-oauth.ts:181); F#2 server `capacitor://localhost` (index.ts, clerk-authorized-parties.ts); F#3 `standardBrowser` (clerk-native-instance.ts, clerk-capacitor-config.ts); F#4 `_is_native` (main.tsx, clerk-native-instance.ts); F#5 `allowedRedirectProtocols: ["capacitor:","vettrack:"]` (clerk-capacitor-config.ts:40) |
| 2.7 `BLOCKER` session/client JWT | **PASS** | `native-clerk-session-token.ts` has `isClerkSessionJwt` (l.33) + `CLERK_CLIENT_JWT_STORAGE_KEY` (l.4) |
| 2.8 pk_live + API origin baked | **PASS** (was FAIL) | `index-B55qduwx.js` contains `pk_live_…` + `https://vettrack.uk` (8 hits) |
| 2.9 signin chunk > 8KB | **PASS** (was FAIL) | `signin-BYAQRsBR.js` = **15684 B** |
| 2.10 tsc clean | **PASS** | dev-lane `npx tsc --noEmit` → exit 0 |
| 2.11 native auth tests | **PASS** | 3 files / **11 tests** passed |

Scoring: all pass → **1.00**.

### Category 3 — Apple guideline compliance → **0.90** (unchanged)

| # | Result | Evidence |
|---|--------|----------|
| 3.1 `BLOCKER` icon 1024/no-alpha | **PASS** | `sips`: `hasAlpha: no`, `pixelWidth: 1024` |
| 3.2 build ≥ 4 | **PASS** | `CURRENT_PROJECT_VERSION = 20` |
| 3.3 `BLOCKER` demo NOT deletable | **PASS (code) / SKIP (live)** | `account-deletion.service.ts:28` `DEFAULT_PROTECTED_EMAILS=["reviewer@vettrack.uk"]`; `users.ts:1192` `reason: "ACCOUNT_DELETION_PROTECTED"` → 403. Live 403 needs a reviewer **session** JWT — not mintable code-only |
| 3.4 deletion flow in UI | **PASS** | `settings.tsx:560` Danger Zone (5.1.1(v)) |
| 3.5 Apple revocation wired | **PASS (code) / SKIP (Railway vars)** | `account-deletion.service.ts`, `users.ts`, `apple-auth.ts` present; 4 Railway Apple vars are `[H]` |
| 3.6 deletion screen recording | **SKIP `[H]`** | ASC review notes — human |
| 3.7 legal pages live | **PASS** | `/privacy 200  /terms 200  /support 200` |
| 3.8 reviewer notes complete | **SKIP `[H]`** | ASC App Review Information — human |
| 3.9 AASA + entitlements | **PASS** | verify: AASA appID + `/equipment/*`; entitlements `applinks:vettrack.uk` |

Scoring: no mechanical non-BLOCKER fails; trimmed to **0.90** for the unexecutable live-3.3 + `[H]` 3.5 Railway vars / 3.6 / 3.8. Identical carve-out to iteration 1 (nothing in this category changed).

### Category 4 — Native UX polish → **0.83**

| # | Result | Evidence |
|---|--------|----------|
| 4.1 boots to `/signin` (live Clerk card) | **SKIP `[H]`/sim** (was FAIL) | Bundle now built & install-ready; sim smoke not run (no booted simulator). No longer a broken-archive signal |
| 4.2 no white/blank screen | **SKIP `[H]`/sim** (was FAIL) | Same — requires a booted simulator |
| 4.3 no reload loop | **PASS** | `allowedRedirectProtocols: ["capacitor:","vettrack:"]` present (cross-ref 2.6) |
| 4.4 `VetTrackMark` branding | **PASS** | `src/components/vettrack-mark.tsx` exists + `signin.tsx:63` `<VetTrackMark size={40} />` |
| 4.5 badge AA contrast | **PASS** | `alerts-dropdown.tsx:57` + `ShiftChatFab.tsx:45` use `bg-red-700` (no `bg-red-500`) |
| 4.6 no Hebrew in source | **PASS** | ship-lane `i18n-no-hebrew-in-source.test.ts` → 2 passed |

Scoring: 1.0 − 0.17 (one un-run sim smoke jointly covering 4.1+4.2) = **0.83**. Up from 0.66: the bundle now exists, so 4.1/4.2 are deferred human/sim checks rather than broken-archive fails. The single remaining UX risk is whether the built bundle visually boots to a live Clerk card — provable only by `install-ios-sim.sh` on a booted simulator.

---

## What improved since last iteration
- **Cat 2 went from 0.00 (hard-capping the whole eval) to 1.00.** The master gate `verify-resubmission.sh`
  now passes 16/16 (was 9/14). The three "bundle never built" FAILs are fixed (real `index`/`signin`/
  `clerk-native` chunks, pk_live + vettrack.uk baked, signin 15684 B), and the two live-Clerk FAILs were a
  **key-selection** artifact — using `sk_live` (not `sk_test`) shows the production config was already correct.
- **Cat 1 1.4 fixed:** `main` no longer diverged. `merge -s ours` (`13444998`) records `origin/main` as a
  merged ancestor while preserving the verified native-auth tree byte-for-byte; a future fast-forward push
  cannot regress production. Verified `origin/main` adds zero source files `main` lacks.
- **Ship discipline held:** ship tree clean, no debug instrumentation, bundle artifacts correctly gitignored,
  dev lane carries only the harness scratch dir.

## What regressed
- Nothing regressed. The `merge -s ours` is a legitimate reconciliation given `origin/main` is a content
  subset of `main`; taking its versions would have dropped the native-auth chain. No source loss.

## Remaining work before the binary actually reaches App Review (all human-only)
1. **Xcode Archive** from `/Users/dan/vettrack-ship` (S1-5) — not performed by the harness.
2. **Sim smoke (4.1–4.3):** `REPO=$PWD ./scripts/install-ios-sim.sh` → confirm boot to `/signin`, live Clerk
   card (Apple/Google/demo + "Secured by Clerk"), no white screen, no reload loop. This is the last UX risk.
3. **Live 3.3:** `DELETE /api/users/delete-account` with a real reviewer **session** JWT → expect **403**
   `ACCOUNT_DELETION_PROTECTED` (code path confirmed).
4. **4 Railway Apple vars** (`APPLE_TEAM_ID/KEY_ID/CLIENT_ID/PRIVATE_KEY`) + migration `155` (3.5).
5. **ASC reviewer notes + personal-Apple-ID deletion screen recording** (3.6, 3.8).
6. **Push `main`** when origin/GitLab unblocks (currently local-only; fast-forward-safe).

## Specific suggestions for next iteration
- This is a SHIP-grade state for code-only gates. There is **no further Generator code work** required to
  clear the mechanical rubric. The next action is human archive + the sim smoke; if the harness gains a
  booted simulator, re-run 4.1–4.3 to convert the 0.83 → 1.00 and push the total to ~0.99.

## Commands run (evidence trail)
- `git -C …-ship rev-parse --abbrev-ref HEAD` / `status --porcelain` / `log origin/main..main` / `log main..origin/main`
- `cd …-ship && REPO=$PWD ./scripts/verify-resubmission.sh` (sk_live) → `exit=0`, 16/16
- live `curl` to `api.clerk.com/v1/{redirect_urls,instance}`, `vettrack.uk/api/version`, `/privacy /terms /support`
- `rg` §F chain + JWT separation; `wc -c` signin chunk; `rg pk_live/vettrack.uk` index chunk
- `sips` icon; `grep CURRENT_PROJECT_VERSION`; `rg` deletion UI / revocation / VetTrackMark / bg-red-700
- dev-lane `npx tsc --noEmit` → exit 0; `pnpm test` native-auth (11/11); ship-lane i18n test (2/2)
- `git show 13444998` parents + `git merge-base --is-ancestor origin/main main`

`CLERK_SECRET_KEY` sourced from `/Users/dan/vettrack/.env` (`sk_live`, line 6); value never printed.
