# Product Specification: VetTrack iOS Resubmission (1.0.1)

> Generated from brief: "Priority #1 — resubmit after Apple review with ship lane discipline"
>
> This is **not** a greenfield build. The product (VetTrack) already exists and is in
> App Review. This spec is a **ship/release plan** that expands the resubmission brief
> into Generator tasks and Evaluator-checkable gates. The "features" below are **ship
> tasks**, not new product surface. Do not invent unrelated features.

---

## Vision

Success = **build 1.0.1 (20) accepted by Apple App Review**, with zero re-rejection on the
four cited guidelines. Concretely, an Apple reviewer can:

1. Open the app and reach `/signin` with a live Clerk card (no blank/white screen, no reload loop).
2. Sign in with the **demo admin** (`reviewer@vettrack.uk` / *password redacted — see password manager*) and land on `/home` with admin features — login status must be `complete`, never `needs_client_trust`.
3. Sign up / sign in with **Apple** in the **system browser** (not in-WebView) and return to the app authenticated.
4. Delete their account via **Settings → Danger zone → Delete account** (personal Apple ID), with Apple token revocation server-side — and confirm the demo account is **protected** (403).
5. See a real **1024×1024 alpha-stripped VT brand icon**, not the placeholder Capacitor icon.

The binary that achieves this must be archived **only from a clean `vettrack-ship` worktree**,
so the bytes Apple receives match reviewed `main` — never a dirty dev tree with agent WIP.

The "feel" we are protecting: the existing VetTrack clinical UI (navy/clinical palette,
`VetTrackMark` branding, Clerk card appearance). We are **not** restyling — we are shipping.

---

## Ship Lane Architecture

Two directories, one discipline. Source: `docs/mobile/native-ship-worktree-lane-prompt.md`.

| Lane | Path | Tree state | Allowed operations |
|------|------|------------|--------------------|
| **Dev** | `/Users/dan/vettrack` | Dirty OK (25+ WIP files now) | agent edits, `tsc`, tests, commits |
| **Ship** | `/Users/dan/vettrack-ship` | **Clean only** — DOES NOT EXIST YET | `verify-resubmission.sh`, `build-native-shell.sh`, Xcode Archive |

**Why it matters:** `scripts/build-native-shell.sh` runs `vite build` → `cap sync ios` against
**whatever is on disk** (line 53: `pnpm exec vite build`; line 57: `npx cap sync ios`). It does
**not** read only committed files. Archiving from the current dirty dev tree would bake unreviewed
agent WIP (in-flight OAuth refactors, the new `native-clerk-session-token.ts`, debug logs, branding
experiments) into an App Store binary.

**Operator mantra (do not deviate):**
> **Dev tree for agents; ship tree for verify, bundle, and archive — never the same dirty disk.**

One-time setup (human, blocking — see Sprint 1 task S1-2):
```bash
cd /Users/dan/vettrack
git worktree add ../vettrack-ship main
```

Pre-archive gate is run **only** from the ship lane with `REPO=$PWD`:
```bash
cd /Users/dan/vettrack-ship
git status                              # MUST be clean
REPO=$PWD ./scripts/verify-resubmission.sh   # 16/16
REPO=$PWD ./scripts/build-native-shell.sh
```

---

## Design Direction (native shell UX)

This is **existing** VetTrack clinical design — reference it, do not regenerate it. Anti-slop here
means **do not introduce a generic AI palette or restyle the Clerk card**; ship what was reviewed
and verified in the route matrix.

- **Palette / identity**: existing clinical navy + status colors (green available / red issue /
  navy chrome). Notification badges already AA-darkened to `bg-red-700` (#b91c1c, 6.47:1) per
  checklist finding #14 — do not regress to `bg-red-500`.
- **Branding**: `src/components/vettrack-mark.tsx` (NEW WIP) is the `VetTrackMark` brand mark used on
  sign-in / sign-up. Must render correctly (no broken/placeholder mark) on `/signin` and `/signup`.
- **Clerk card appearance**: `src/lib/clerk-appearance.ts` — the live Clerk sign-in card must show
  Apple / Google / demo (`reviewer@vettrack.uk` or `0501234567`) and "Secured by Clerk". This is the
  first screen the reviewer sees; it must not be a dev-bypass shell (verify chunk size > 8KB, pk_live baked).
- **App icon (2.3.8)**: single universal 1024×1024 VT icon, **alpha stripped** at
  `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` — `hasAlpha: no`, `pixelWidth: 1024`.
- **Orientation**: app is portrait-locked via `public/manifest.json`. iPhone landscape = portrait
  letterbox (expected; not a defect). Do not add landscape reflow work to ship scope.
- **Anti-AI-slop directives (ship context)**: no gradient restyle, no new icon set, no "modern card"
  redesign of the Clerk component, no marketing `/` polish — none of these are App-Review blockers and
  all risk regressing a verified surface.

---

## Features (prioritized as SHIP TASKS)

### Must-Have (Sprint 1 — unblock archive)

**S1-1 — Land the native-auth WIP on `main` (dev lane).**
- The dev tree is **DIRTY** with the load-bearing native-auth work that the verified bundle depends
  on. These must be committed/merged to `main` before the ship worktree can pull a correct tree:
  - NEW: `src/lib/native-clerk-session-token.ts` (session vs client JWT separation — `sid`-claim
    detection so the client JWT is never sent to `/api`).
  - `src/lib/native-apple-link.ts`, `src/lib/native-oauth.ts`, `src/hooks/use-auth.tsx`,
    `src/pages/signin.tsx`, `src/pages/signup.tsx`, `src/components/native-social-buttons.tsx`,
    `src/main.tsx`, `src/lib/api.ts`, `src/lib/clerk-appearance.ts`.
  - NEW: `src/components/vettrack-mark.tsx` (branding).
  - Server: `server/lib/clerk-authorized-parties.ts`, `server/middleware/auth.ts`,
    `server/middleware/tenant-context.ts`, `server/lib/auth-mode.ts`, `server/index.ts`.
  - Tests (NEW): `tests/native-apple-link.test.ts`, `tests/native-clerk-session-token.test.ts`;
    plus modified `tests/clerk-authorized-parties.test.ts`, `tests/auth-*.test.ts`, `tests/app-version.test.ts`.
  - Docs: `RESUBMISSION_RUNBOOK.md`, `docs/mobile/native-ship-checklist.md`,
    `docs/mobile/native-ship-worktree-lane-prompt.md`.
  - Xcode: `ios/App/App.xcodeproj/project.pbxproj` (build 20). Locales: `locales/{en,he}.json`.
- **Acceptance:** `git status --porcelain` in dev lane returns empty after commit; `npx tsc --noEmit`
  passes (0 errors); `pnpm test` passes for the touched auth/native tests; no debug instrumentation
  committed (no `fetch('http://127.0.0.1:7630/...`, no `#region agent log`). `main` HEAD advanced past
  `6e36be3c`.

**S1-2 — Create the ship worktree (one-time, human).**
- `cd /Users/dan/vettrack && git worktree add ../vettrack-ship main`.
- **Acceptance:** `/Users/dan/vettrack-ship` exists; `git -C /Users/dan/vettrack-ship status` is clean
  and on `main` at the same SHA as dev-lane `main` (i.e. includes S1-1).

**S1-3 — Run the 16-gate pre-archive verify from the ship lane.**
- `cd /Users/dan/vettrack-ship && REPO=$PWD ./scripts/verify-resubmission.sh` with `CLERK_SECRET_KEY` exported.
- The 16 gates (from `scripts/verify-resubmission.sh`): demo login `complete`; redirect URL
  `vettrack://oauth-callback`; `allowed_origins` has `capacitor://localhost`; `/api/version` ACAO =
  `capacitor://localhost`; icon 1024 / hasAlpha no; build number ≥ 4; bundled (no `server.url`); native
  Clerk chunk present; `pk_live` baked; `vettrack.uk` baked; signin chunk > 8KB; 3 Control widget files;
  AASA appID + `/equipment/*`; entitlements `applinks:vettrack.uk`.
- **Acceptance:** script exits 0 — "16/16 PASS / ✅ ALL GATES PASS". (RESUBMISSION_RUNBOOK §C mirrors these.)

**S1-4 — Build the bundled native shell from the ship lane.**
- `cd /Users/dan/vettrack-ship && REPO=$PWD ./scripts/build-native-shell.sh` (ios default).
- Bakes `VITE_CLERK_PUBLISHABLE_KEY` (`pk_live_*`) + `VITE_API_ORIGIN=https://vettrack.uk` from `.env`
  only (ignores `.env.local`). **Never** pass `CAPACITOR_SERVER_URL`.
- **Acceptance:** `dist/public` == `ios/App/App/public`; re-running S1-3 still 16/16 (no stale-bundle
  drift); optional sim smoke `REPO=$PWD ./scripts/install-ios-sim.sh` boots to `/signin` with the live
  Clerk card.

**S1-5 — Archive in Xcode from the ship worktree (human only).**
- Open `ios/App/App.xcworkspace` **under `/Users/dan/vettrack-ship`**. Destination: Any iOS Device
  (arm64) → Clean Build Folder → Product → Archive → Distribute → App Store Connect → Upload (automatic
  signing). Bump build number first if 20 is already consumed (`cd ios/App && agvtool new-version -all <n>`).
- **Acceptance:** build 1.0.1 (20) (or next) appears in App Store Connect "Processing", then ready.

**S1-6 — Resubmit in App Store Connect (human).**
- Select build 1.0.1 (20) on the 1.0 version. App Review Information: Sign-In required = Yes;
  `reviewer@vettrack.uk` / *password redacted — see password manager*; reviewer notes (system-browser OAuth, demo admin, demo
  account cannot be deleted, personal-Apple-ID deletion path). Confirm Client Trust permanently OFF
  before submit. Add for Review → Submit.
- **Acceptance:** version status = "Waiting for Review"; reviewer notes include the deletion test steps
  and the demo credentials; deletion screen recording attached (see S2-3).

### Should-Have (Sprint 2 — reduce re-rejection risk)

**S2-1 — Client Trust monitoring (HIGH residual risk).**
- The #1 re-rejection cause. Before submit and right after, re-run the §C demo-login curl and confirm
  Clerk → Configure → Updates shows "Client Trust" reverted, not on a 24h timer.
- **Acceptance:** demo login returns `LOGIN: complete` at submit time; documented confirmation that
  Client Trust is off (not timed).

**S2-2 — Production deploy / unpushed-commit sync (MEDIUM risk).**
- The reviewer hits production API + Clerk. If CI later deploys `origin/main` while local fix commits
  are unpushed, production **regresses**. Push `main` to origin before any CI deploy; if deploying
  directly, `railway up --detach` from `/Users/dan/.vt-deploy` (not via `.` path arg).
- **Acceptance:** `git log origin/main..main` is empty (or commits intentionally pushed); production
  `/api/version` and demo login verified live post-deploy.

**S2-3 — Account-deletion screen recording + demo-account 403.**
- Record one continuous video with a **personal** Apple ID: Sign in with Apple → Settings → Danger
  zone → Delete account → type `DELETE`/`מחק` → success toast → signed out. Verify demo account is
  protected: `DELETE /api/users/delete-account` with reviewer JWT returns **403** (`ACCOUNT_DELETION_PROTECTED`).
- **Acceptance:** video attached in App Review notes; 403 confirmed via curl (RESUBMISSION_RUNBOOK §K).

**S2-4 — Apple revocation env + legal pages verify.**
- Confirm Railway vars `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` (`uk.vettrack.app`),
  `APPLE_PRIVATE_KEY` set; migration `155_apple_oauth_tokens` applied. Verify `/privacy`, `/terms`,
  `/support` return 200 on production before setting store URLs.
- **Acceptance:** the four Apple vars present; deletion of an Apple-linked account revokes the token
  server-side; three legal pages 200 on `vettrack.uk`.

### Nice-to-Have (Sprint 3+ — post-acceptance cleanup, non-blocking)

**S3-1 — Version banner alignment.** Web `/api/version` shows `1.1.2` while native shows
`1.0.1 · Build 20`. Tag backend to the shipped native build so the in-app update banner stops
mismatching (RESUBMISSION_RUNBOOK §J; checklist advisory A-1).

**S3-2 — `archive-from-clean-tree.sh` guard script.** Codify the ship-lane refusal logic (refuse if
cwd is dev lane and `git status --porcelain` non-empty; refuse if ship behind `origin/main` or dirty)
into a script so the discipline is enforced mechanically, not by memory.

**S3-3 — Route-matrix gaps.** Human spot-pass for the remaining iPhone P routes (`/help`, `/audit-log`,
`/crash-cart`, `/admin/shifts`, `/signup`, `/equipment?scan=1` full), iPad-L per-route landscape, and
the NFC device matrix (`nfc-ship-checklist.md`) on physical TestFlight hardware. None block the archive.

**S3-4 — Push the local-only commits to origin** the moment GitLab/origin unblocks; fix Railway Worker
start command (`pnpm worker`) and the malformed `NODE_ENV` var (RESUBMISSION_RUNBOOK §J).

---

## Technical Stack (existing — do not change)

- **Native shell**: Capacitor v8, **bundled** iOS shell (no `server.url` / `CAPACITOR_SERVER_URL`).
- **Auth**: Clerk production instance `clerk.vettrack.uk`; native FAPI transport (`_is_native=1` +
  client JWT in `Authorization`); system-browser OAuth via `startNativeOAuth`; `standardBrowser: false`;
  `allowedRedirectProtocols: ["capacitor:","vettrack:"]`. Session JWT (`sid` claim) resolved for `/api`
  by `src/lib/native-clerk-session-token.ts`.
- **Backend**: Express + TypeScript on Railway (project `pacific-flow`, service `VetTrack`), PostgreSQL +
  Drizzle. API origin `https://vettrack.uk`.
- **Build pipeline**: `scripts/build-native-shell.sh` (`vite build` → `cap sync ios`) →
  `scripts/verify-resubmission.sh` (16 gates) → Xcode Archive.
- **Frozen invariants (never break during ship fixes):** bundled-shell only; native OAuth via
  `startNativeOAuth` (not native `SignInWithApple` without sign-off); the six load-bearing fixes in
  RESUBMISSION_RUNBOOK §F; do not refactor SSE, Code Blue offline block, or Strategy A authority.
- **Maintenance scope:** Capacitor only — **no Expo / React Native** (see `docs/MAINTENANCE_MODE.md`).

---

## Evaluation Criteria

Customized for **App Review resubmission**, not generic SaaS. The detailed, mechanically-checkable
version is in `gan-harness/eval-rubric.md`. Summary of what "good" means here:

### Ship lane discipline (weight: 0.25)
Clean ship tree, archive sourced from `/Users/dan/vettrack-ship` on `main`, no debug instrumentation,
no duplicated source files, dev WIP committed before bundle.

### Auth / resubmission gates (weight: 0.35)
`verify-resubmission.sh` 16/16; demo login `complete` (not `needs_client_trust`); the six §F native-OAuth
fixes intact; session-vs-client JWT separation present; `pk_live` + `vettrack.uk` baked.

### Apple guideline compliance (weight: 0.25)
2.3.8 icon (1024 / no-alpha); 5.1.1(v) deletion flow + Apple revocation + demo 403; 2.1 demo login
works on a fresh device; 2.1(a) Apple sign-up in system browser; reviewer notes complete.

### Native UX polish (weight: 0.15)
`/signin` + `/signup` render the live Clerk card with `VetTrackMark`; no white screen; no reload loop;
boots to `/signin`; AA badge contrast retained.

---

## Sprint Plan

### Sprint 1: Land + Verify + Archive
- **Goals:** dev WIP committed to `main`; ship worktree created; 16/16 gate green from ship lane;
  bundle built from clean tree; archived + uploaded.
- **Tasks:** S1-1 → S1-6.
- **Definition of done:** build 1.0.1 (20) in App Store Connect, submitted for review, archive provably
  sourced from a clean `vettrack-ship` tree (no dirty-dev archive).

### Sprint 2: Submit + Monitor
- **Goals:** minimize re-rejection on the four guidelines.
- **Tasks:** S2-1 (Client Trust watch) · S2-2 (prod/commit sync) · S2-3 (deletion video + demo 403) ·
  S2-4 (Apple revocation env + legal pages).
- **Definition of done:** demo login `complete` at submit; deletion video attached; demo account 403;
  production not regressed; legal pages 200.

### Sprint 3: Post-acceptance cleanup (non-blocking)
- **Goals:** pay down deferred items without touching frozen surfaces.
- **Tasks:** S3-1 (version banner) · S3-2 (archive-guard script) · S3-3 (route-matrix + NFC device
  matrix) · S3-4 (push commits, Railway worker/NODE_ENV fix).
- **Definition of done:** version banners aligned; ship discipline scripted; remaining matrix cells
  spot-checked; commits pushed.

---

## Top blockers (operator snapshot)

1. **Dirty dev tree (25+ files) — must commit/merge to `main` before anything ships.** The native-auth
   WIP (incl. NEW `native-clerk-session-token.ts`, `vettrack-mark.tsx`) is what the verified bundle
   depends on; archiving now would bake unreviewed WIP. (S1-1)
2. **`vettrack-ship` worktree does not exist.** `git worktree add ../vettrack-ship main` is the gate
   for a clean-tree archive. Until it exists, every archive path violates ship discipline. (S1-2)
3. **Clerk Client Trust can silently flip back on** → demo login fails (`needs_client_trust`) → instant
   2.1 re-rejection. Re-run the §C demo-login check immediately before submit. (S2-1)
