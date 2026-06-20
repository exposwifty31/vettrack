# Generator State — Iteration 002

Iteration 2 of the VetTrack iOS 1.0.1 resubmission ship lane. Iteration 1 landed
S1-1/S1-2 (commit `ac25a23f`) but scored **4.0/10 DO NOT ARCHIVE** because BLOCKER 2.1
(`verify-resubmission.sh`) failed 5/14 gates: the native bundle was never built into the
ship worktree and two live-Clerk gates read as missing. This iteration closes all of that.

## Result (headline)

- **`verify-resubmission.sh` from ship lane: exit 0 — PASS 16 / FAIL 0 — "✅ ALL GATES PASS".**
- Native bundle **built** in the ship lane (`dist/public` → `ios/App/App/public`, `capacitor.config.json` generated).
- Clerk production config **confirmed correct** (both gates pass).
- `main` **reconciled** with `origin/main` (no longer behind/diverged).
- Both trees clean; no debug instrumentation; verified native-auth tree preserved byte-for-byte.

## What Changed This Iteration

### 1. S1-4 — Built the bundled native shell in the ship lane
- `cd /Users/dan/vettrack-ship && pnpm install` (node_modules was absent — root cause of the
  iteration-1 bundle FAILs).
- Copied dev `.env` → ship `.env` (gitignored; `.env.local` deliberately NOT used — it blanks
  Clerk for web dev). Ship `.env` carries `VITE_CLERK_PUBLISHABLE_KEY=pk_live_*` + `VITE_API_ORIGIN=https://vettrack.uk`.
- `REPO=$PWD ./scripts/build-native-shell.sh` → `vite build` then `cap sync ios` (with
  `CAPACITOR_SERVER_URL` unset — bundled shell, never a thin web wrapper).
- Produced: `clerk-native-instance-*.js` (native Clerk chunk), `signin-*.js` (**15684 B** > 8 KB
  real Clerk UI), `index-*.js` with `pk_live` and `https://vettrack.uk` baked. `capacitor.config.json`
  has **no `server.url`**. All bundle artifacts are gitignored → ship tree stays clean.
- **Clears verify FAILs:** bundled-shell, native Clerk chunk, pk_live baked, vettrack.uk baked, signin > 8KB.

### 2. Clerk dashboard config (checks 2.3, 2.4) — confirmed already correct on production
- Queried the **production** Clerk instance with the `sk_live` key from `.env`:
  - `redirect_urls` already contains `vettrack://oauth-callback` ✅
  - `allowed_origins` already contains `capacitor://localhost` ✅
- No mutation issued — the desired state already holds, and a blind `PATCH /v1/instance` would risk
  dropping the other live origins (`https://vettrack.uk`, `https://www.vettrack.uk`, `ionic://localhost`).
- **Root cause of the iteration-1 "MISSING" reads:** `.env` carries **two** `CLERK_SECRET_KEY`
  lines — `sk_test_…` (line 4) and `sk_live_…` (line 6). Reading the first match (`sk_test`) targets a
  **different** Clerk instance that lacks the production config. Running verify with the `sk_live` key
  (or letting it pull from Railway) makes 2.3/2.4 pass. The verify run below used the `sk_live` key.

### 3. S2-2 / check 1.4 — Reconciled `main` with `origin/main`
- Before: local `main` was **9 ahead, 1 behind** (`origin/main` = `8604fd78`, the squashed legal-pages
  PR #2). Diverged history → CI deploying `origin/main` would regress production (it lacks the
  native-auth chain).
- Investigated the divergence: `origin/main` (`8604fd78`) is an **older squash** of
  legal/account/maintenance work that local `main` already contains as separate commits, and it is
  **missing** the verified native-auth files (`native-clerk-session-token.ts`,
  `clerk-authorized-parties.ts`, `vettrack-mark.tsx`, `app-version.ts`) plus the six §F OAuth fixes.
  A normal merge conflicted exactly on those load-bearing files; `origin/main` adds **zero** source
  files that `main` lacks.
- Reconciled with **`git merge -s ours origin/main`** (commit `13444998`): records `origin/main` as a
  merged ancestor while keeping `main`'s verified tree byte-for-byte. Now `git log main..origin/main`
  is **empty** (not behind); `main` is strictly ahead by 10. A future `git push origin main` fast-forwards
  origin → production cannot regress. **Not pushed** (no push requested; safe to push when GitLab/origin unblocks).

## Verify Output (ship lane, exit 0)
```
PASS  login status = complete
PASS  redirect URL vettrack://oauth-callback present
PASS  allowed_origins includes capacitor://localhost
PASS  /api/version ACAO = capacitor://localhost
PASS  icon 1024 px, hasAlpha=no
PASS  CURRENT_PROJECT_VERSION = 20 (>=4)
PASS  bundled (no server.url)
PASS  native Clerk chunk present
PASS  Clerk pk_live baked into bundle
PASS  VITE_API_ORIGIN baked (vettrack.uk)
PASS  signin chunk 15684B (Clerk UI)
PASS  VetTrackScanControl.swift / AppIntent+OpenScan.swift / VetTrackControl.swift present
PASS  AASA appID + /equipment/* path
PASS  entitlements applinks:vettrack.uk
PASS: 16   FAIL: 0   →  ✅ ALL GATES PASS   (VERIFY_EXIT=0)
```

## Ship Discipline Snapshot
- **Ship lane** `/Users/dan/vettrack-ship`: branch `main`, HEAD `13444998`, `git status --porcelain` empty.
- **Dev lane** `/Users/dan/vettrack`: branch `feat/legal-pages-privacy-terms-support`, porcelain shows
  only `?? gan-harness/` (the harness's own scratch dir — never committed into the resubmission history).
- No debug instrumentation in ship `src`/`server` (`127.0.0.1:7630` / `#region agent log` → 0 matches).

## Not Done (human-only / out of scope per instructions)
- **S1-5** Xcode Archive from the ship worktree — human only (did NOT archive).
- **S1-6** App Store Connect resubmit + reviewer notes — human only.
- **S2-3** personal-Apple-ID deletion screen recording; live `403` for demo account requires a real
  reviewer **session** JWT (code path verified: `ACCOUNT_DELETION_PROTECTED`).
- **S2-4** Railway Apple vars (`APPLE_TEAM_ID/KEY_ID/CLIENT_ID/PRIVATE_KEY`) + migration `155` — `[H]`.
- **Sim smoke (4.1–4.3):** `REPO=$PWD ./scripts/install-ios-sim.sh` (boots to `/signin`, live Clerk card)
  — optional, requires a booted simulator; bundle is built and ready for it.
- **Push to origin:** not performed (not requested; `main` advance + reconciliation are local only).

## Notes for Evaluator
- Run verify with the **`sk_live`** `CLERK_SECRET_KEY` (or let the script pull it from Railway). The
  dev `.env` contains both an `sk_test` and an `sk_live` key; the `sk_test` one targets a different
  Clerk instance and will read 2.3/2.4 as MISSING (this was the iteration-1 false-FAIL).
- `main` reconciliation used `-s ours` intentionally: `origin/main`'s squash is a content subset of
  `main`, and taking its versions would regress the verified native-auth tree.
