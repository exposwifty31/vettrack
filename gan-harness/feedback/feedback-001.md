# Evaluation — Iteration 001 (VetTrack iOS 1.0.1 Resubmission)

**Eval mode:** code-only (mechanical ship gates). **Evaluator stance:** ruthless ship-readiness.
**Commit under test:** `ac25a23f` (`main`, mirrored in ship lane). **Date:** 2026-06-18.

---

## Scores

| Category | Weight | Raw score | Weighted |
|----------|--------|-----------|----------|
| 1 — Ship lane discipline | 0.25 | 0.85 | 0.2125 |
| 2 — Auth / resubmission gates | 0.35 | **0.00** (BLOCKER fail) | 0.0000 |
| 3 — Apple guideline compliance | 0.25 | 0.90 | 0.2250 |
| 4 — Native UX polish | 0.15 | 0.66 | 0.0990 |
| **Uncapped total** | | | **0.5365** |
| **Hard cap (BLOCKER fail)** | | | **0.40** |

### Weighted total: **0.40 / 1.0  →  4.0 / 10**

> `total = 0.25·0.85 + 0.35·0.00 + 0.25·0.90 + 0.15·0.66 = 0.5365`, capped at **0.40** because BLOCKER **2.1** failed.

## Verdict: **DO NOT ARCHIVE**

A binary cannot be archived from this state: the native bundle has never been built into the ship
worktree, and `verify-resubmission.sh` fails 5/14 gates (exit 1, "DO NOT ARCHIVE"). Even if the bundle
were built, two **live Clerk dashboard** gates (redirect URL + allowed origins) are currently missing,
which is a direct Apple-2.1 OAuth re-rejection risk.

---

## BLOCKER failures (each one independently caps at 0.40)

1. **2.1 — 16-gate `verify-resubmission.sh` FAILS (PASS 9 / FAIL 5, exit 1).** This is the master
   ship gate. It fails for two distinct reasons (bundle + Clerk config), detailed below.

The other BLOCKER checks **passed**: 1.1, 1.2, 1.5 (ship discipline), 2.2 (demo login `complete`),
2.6 (§F chain), 2.7 (session-vs-client JWT), 3.1 (icon). 3.3 (demo-account protection) is code-verified
but its live reviewer-JWT 403 was not executed (see SKIPs).

---

## Per-check evidence

### Category 1 — Ship lane discipline → **0.85** (all BLOCKERs pass; 1 non-BLOCKER fail)

| # | Result | Evidence |
|---|--------|----------|
| 1.1 `BLOCKER` ship on `main` | **PASS** | `rev-parse --abbrev-ref HEAD` → `main` |
| 1.2 `BLOCKER` ship clean | **PASS** | `status --porcelain` → empty |
| 1.3 `BLOCKER` dev clean | **PASS** | dev porcelain → only `?? gan-harness/` (harness scaffolding, no native-auth WIP) |
| 1.4 ship not behind origin | **FAIL** | `origin/main..main` = 9 unpushed commits; **`main..origin/main` = `8604fd78` (legal pages #2)** — local `main` has **diverged** from `origin/main` (9 ahead AND 1 behind) |
| 1.5 `BLOCKER` no debug instrumentation | **PASS** | `rg "127.0.0.1:7630\|#region agent log"` ship src/server → 0 matches |
| 1.6 no duplicated ship source | **PASS** | `src-ship` absent; no `signin-ship` matches |
| 1.7 no `server.url` baked | **PASS** | `capacitor.config.ts` sets `server` only when `CAPACITOR_SERVER_URL` is set; default `undefined` |
| 1.8 no `CAPACITOR_SERVER_URL` | **PASS** | ship lane has no `.env`; var unset |

Scoring: 1.0 − 0.15 (1.4) = **0.85**.

### Category 2 — Auth / resubmission gates → **0.00** (BLOCKER 2.1 fail → category 0 + hard cap)

| # | Result | Evidence |
|---|--------|----------|
| 2.1 `BLOCKER` verify passes | **FAIL** | `PASS: 9  FAIL: 5`, `VERIFY_EXIT=1`, "❌ DO NOT ARCHIVE" |
| 2.2 `BLOCKER` demo login complete | **PASS** | `[2.1] login status = complete` |
| 2.3 redirect URL allowlisted | **FAIL** | `redirect URL vettrack://oauth-callback MISSING` (Clerk admin) |
| 2.4 allowed origins capacitor | **FAIL** | `allowed_origins MISSING capacitor://localhost` (Clerk admin) |
| 2.5 API CORS for shell | **PASS** | `/api/version ACAO = capacitor://localhost` |
| 2.6 `BLOCKER` six §F fixes | **PASS** | F#1 `startNativeOAuth`=1, F#2 server `capacitor://localhost`=3, F#3 `standardBrowser`=2, F#4 `_is_native`=2, F#5 `allowedRedirectProtocols`=`["capacitor:","vettrack:"]` |
| 2.7 `BLOCKER` session/client JWT | **PASS** | `native-clerk-session-token.ts` has `isClerkSessionJwt` + `CLERK_CLIENT_JWT_STORAGE_KEY` |
| 2.8 pk_live + API origin baked | **FAIL** | `bundled assets dir missing` — bundle never built |
| 2.9 signin chunk > 8KB | **FAIL** | `signin-*.js missing` — no `ios/App/App/public` at all |
| 2.10 tsc clean | **PASS** | `npx tsc --noEmit` → exit 0, 0 errors |
| 2.11 native auth tests | **PASS** | 3 files / 11 tests passed |

Root causes of the 5 verify FAILs:
- **Bundle never built (3 FAILs):** `ios/App/App/public` does not exist, and `ios/App/App/capacitor.config.json`
  is not generated (only `capacitor.config.ts`). `S1-4 build-native-shell.sh` and `cap sync ios` were
  never run, and the ship worktree has **no `node_modules`** (`pnpm install` not run).
- **Clerk dashboard config (2 FAILs):** `vettrack://oauth-callback` redirect URL and `capacitor://localhost`
  allowed origin are absent on the live instance. These are **not in code** — they require the Clerk admin
  dashboard / API and will keep failing verify even after the bundle is built.

### Category 3 — Apple guideline compliance → **0.90**

| # | Result | Evidence |
|---|--------|----------|
| 3.1 `BLOCKER` icon 1024/no-alpha | **PASS** | `sips`: `hasAlpha: no`, `pixelWidth: 1024`, `pixelHeight: 1024` |
| 3.2 build ≥ 4 | **PASS** | `CURRENT_PROJECT_VERSION = 20` |
| 3.3 `BLOCKER` demo NOT deletable | **PASS (code) / SKIP (live)** | Code: `DEFAULT_PROTECTED_EMAILS=["reviewer@vettrack.uk"]`, `ACCOUNT_DELETION_PROTECTED`, `users.ts:1192` returns 403. Live 403 needs a reviewer session JWT (not minted here); no-auth probe → 401, invalid-bearer → 500 |
| 3.4 deletion flow in UI | **PASS** | `settings.tsx:560` Danger Zone (5.1.1(v)) |
| 3.5 Apple revocation wired | **PASS (code) / SKIP (Railway vars)** | `account-deletion.service.ts` → `revokeAppleToken`, `apple-auth.ts` `authorizationCode`, audit kinds `apple_token_revoked/…`. 4 Railway Apple vars are `[H]` — not verifiable in code-only |
| 3.6 deletion screen recording | **SKIP `[H]`** | App Store Connect review notes — human |
| 3.7 legal pages live | **PASS** | `/privacy 200  /terms 200  /support 200` |
| 3.8 reviewer notes complete | **SKIP `[H]`** | ASC App Review Information — human |
| 3.9 AASA + entitlements | **PASS** | verify: AASA appID + `/equipment/*`; entitlements `applinks:vettrack.uk` |

Scoring: no mechanical non-BLOCKER fails; trimmed to **0.90** for the unexecutable 3.3-live + `[H]` 3.6/3.8 / Railway-var portions.

### Category 4 — Native UX polish → **0.66**

| # | Result | Evidence |
|---|--------|----------|
| 4.1 boots to `/signin` (live Clerk card) | **FAIL / unverifiable** | No bundle + no sim install possible; archive cannot be smoke-tested |
| 4.2 no white/blank screen | **FAIL / unverifiable** | Same — nothing to launch |
| 4.3 no reload loop | **PASS (mechanical)** | `allowedRedirectProtocols: ["capacitor:","vettrack:"]` present (cross-ref 2.6) |
| 4.4 `VetTrackMark` branding | **PASS** | `src/components/vettrack-mark.tsx` exists + referenced in `signin.tsx:63` |
| 4.5 badge AA contrast | **PASS** | `alerts-dropdown.tsx` + `ShiftChatFab.tsx` use `bg-red-700` (no `bg-red-500`) |
| 4.6 no Hebrew in source | **PASS** | `i18n-no-hebrew-in-source.test.ts` → 2 passed |

Scoring: 1.0 − 0.17·2 (4.1, 4.2 unverifiable/broken-archive) = **0.66**. 4.1–4.2 failing strongly signals
a non-shippable archive — flagged prominently.

---

## What improved since last iteration
- First iteration — no prior baseline. Genuinely solid groundwork landed: native-auth WIP committed
  cleanly (no debug instrumentation), `tsc` green, 11/11 native-auth tests pass, the six §F fixes and
  session-vs-client JWT separation are all intact, icon is correctly alpha-stripped at 1024, demo login
  returns `complete`, and legal pages are live. The **code** is in good shape; the **archive pipeline** is not.

## What regressed
- Nothing regressed vs. a prior iteration. New concern surfaced: local `main` has **diverged** from
  `origin/main` (origin has `8604fd78` legal-pages #2 that local `main` lacks) — the S2-2 production-regression
  risk is now concrete, not hypothetical.

---

## Actionable fixes for Generator iteration 2 (ordered)

1. **Install deps + build the bundle in the ship lane (clears 3 of 5 verify FAILs).**
   ```bash
   cd /Users/dan/vettrack-ship && pnpm install
   REPO=$PWD ./scripts/build-native-shell.sh        # vite build → cap sync ios (NO CAPACITOR_SERVER_URL)
   ```
   This generates `ios/App/App/public/assets/*` (index/signin/clerk-native chunks) and
   `ios/App/App/capacitor.config.json` → fixes 2.8, 2.9, and the "bundled shell"/"native bundle auth" gates.
   Re-run verify and confirm `pk_live` + `https://vettrack.uk` are baked and `signin-*.js > 8KB`.

2. **Fix the live Clerk dashboard config (clears the remaining 2 verify FAILs — and is a real Apple-2.1 risk).**
   - Add redirect URL `vettrack://oauth-callback` to the Clerk instance.
   - Add `capacitor://localhost` to `allowed_origins`.
   These are admin/API changes, not code. Verify with the `/v1/redirect_urls` and `/v1/instance` curls.
   Without them, system-browser Apple/Google OAuth will not return to the app → re-rejection.

3. **Reconcile `main` with `origin/main` before any CI deploy (S2-2).**
   Local `main` is 9 ahead and **1 behind** (`8604fd78`). Either push `main` to origin or rebase/merge
   `8604fd78` so production cannot regress when CI deploys `origin/main`. Confirm `git log origin/main..main`
   reflects an intentional, reconciled state.

4. **Re-run the full gate from the ship lane and require exit 0.**
   ```bash
   cd /Users/dan/vettrack-ship && REPO=$PWD ./scripts/verify-resubmission.sh   # must print "✅ ALL GATES PASS"
   ```

5. **Then (human) execute the live + UX gates** that code-only cannot:
   - 3.3 live: `DELETE /api/users/delete-account` with a **reviewer** session JWT → expect **403**
     `ACCOUNT_DELETION_PROTECTED` (code path confirmed present).
   - 3.5: confirm the 4 Apple Railway vars (`APPLE_TEAM_ID/KEY_ID/CLIENT_ID/PRIVATE_KEY`) + migration
     `155_apple_oauth_tokens`.
   - 4.1–4.3: `REPO=$PWD ./scripts/install-ios-sim.sh` → boots to `/signin`, live Clerk card with
     Apple/Google/demo + "Secured by Clerk", no white screen, no reload loop.
   - 3.6/3.8: attach the personal-Apple-ID deletion screen recording + complete reviewer notes in ASC.

6. **Housekeeping:** relocate/keep `gan-harness/` out of the product tree (it is the only dev-lane porcelain
   entry and must never be committed into the resubmission history).

---

## SKIPs (code-only mode — not penalized as outright fails, but unverified)
- **3.3 live** (needs reviewer session JWT) — code path verified, live 403 not executed.
- **3.5 Railway Apple vars** — `[H]`, not in repo.
- **3.6, 3.8** — `[H]` App Store Connect (recording + reviewer notes).
- **4.1, 4.2** — require a built bundle + simulator; counted against Category 4 because the bundle does
  not exist (broken-archive signal), not merely deferred.

`CLERK_SECRET_KEY` was sourced from `/Users/dan/vettrack/.env` (value never printed) to run the live gates.
