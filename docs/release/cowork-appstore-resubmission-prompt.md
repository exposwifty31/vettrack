# App Store Resubmission — Claude Cowork Prompt (Phase 10 close-out, owner-run)

> **What this is.** A ready-to-paste prompt for **Claude cowork**, driven by the owner, to ship a VetTrack update to the App Store. The app is **live** (App Store approved), so this is an ongoing **update/release** flow, not a first-time blocked resubmission. The prompt is grounded in the repo's *real* pipeline (verified against the actual scripts) — the version bump goes through the Phase-10.B tooling, and the native build goes through the one sanctioned path.
>
> **Owner-run.** The archive/upload and App Store Connect steps require the owner's Apple ID, signing, and Xcode. Cowork drives the repo steps + walks the owner through Xcode/ASC; the owner performs the credentialed actions.
>
> **Two hard rules (from CLAUDE.md — do not deviate):**
> 1. **Build only via `pnpm cap:build:native`** (`scripts/build-native-shell.sh`). It bakes `VITE_CLERK_PUBLISHABLE_KEY` + `VITE_API_ORIGIN` from `.env` (ignores `.env.local`) and **never** sets `CAPACITOR_SERVER_URL`. A plain `pnpm build && npx cap sync` ships a Clerk-less bundle that falls into dev-bypass and crashes on `useUser` — and a thin web wrapper breaks App Review 4.2 + social OAuth.
> 2. **Bump the version via the resubmit tooling** (`pnpm resubmit` / `pnpm resubmit:release`), never by hand — it single-sources `package.json` + iOS `MARKETING_VERSION` + `CFBundleVersion` so they can't drift.

---

## Version state going in (Phase 10.B reconciliation)

`package.json` `1.1.2` is the source of truth. Phase 10.B brought iOS `MARKETING_VERSION` up to `1.1.2`, pinned `Info.plist` `CFBundleVersion` to `$(CURRENT_PROJECT_VERSION)`, and set `ios/.last-shipped-build` = the last uploaded build. Pick the mode:
- **Same marketing version, new binary** (rejection fix / re-upload): `pnpm resubmit` → build `n → n+1`, marketing unchanged.
- **New product version** (this update ships new work): `pnpm resubmit:release <M.m.p>` → you pick the level (patch/minor/major — reserve major for warranted releases), marketing set to `<M.m.p>`, build seeded `n+1`.

After a successful App Store upload, bump `ios/.last-shipped-build` to the uploaded build number (the resubmit script prints this reminder).

---

```text
═══ PROMPT STARTS ═══

You are a release engineer helping the owner ship a VetTrack update to the App
Store. You drive the repo commands and walk the owner through Xcode + App Store
Connect; the owner performs anything needing their Apple ID / signing. VetTrack is
LIVE on the App Store — this is an update. Work in the checked-out VetTrack repo —
confirm its path with the owner before running any command (do not assume a
hardcoded location). Be precise; confirm each gate before moving on. Never
hand-edit version numbers or run a plain web build.

## Step 0 — Decide the version bump
Ask the owner: is this a re-upload of the SAME marketing version (rejection fix),
or a NEW product version (new work)?
  - Same version →  pnpm resubmit
  - New version  →  pnpm resubmit:release <M.m.p>   (owner picks the level)
The script single-sources package.json + iOS MARKETING_VERSION + CFBundleVersion,
then runs the resubmission verifier. Read its output; do not proceed on a failure.

## Step 1 — Pre-flight gates (all must pass)
  - pnpm auth:preflight       (Clerk config + auth mode sane)
  - pnpm validate:prod        (pre-deployment checks)
  - pnpm verify:resubmission   (build number strictly greater than ios/.last-shipped-build;
                                demo login completes, Clerk redirect/origins, CORS
                                capacitor://localhost, bundled pk_live shell, AASA/
                                entitlements, icon)
If any gate fails, stop and surface the exact failure to the owner. Do not "fix"
signing/Clerk config yourself — that's the owner's credentialed action.

## Step 2 — Build the native shell (the ONE sanctioned path)
  pnpm cap:build:native            # iOS (default)
  pnpm cap:build:native:android    # Android
  pnpm cap:build:native:all        # both platforms
Confirm it read .env (not .env.local) and did NOT set CAPACITOR_SERVER_URL. If the
build warns about a missing VITE_CLERK_PUBLISHABLE_KEY, STOP — .env is misconfigured
and the shell would ship in dev-bypass.

## Step 3 — Archive + upload (owner-run, via Xcode)
  pnpm cap:open:ios            (opens the Xcode project)
Walk the owner through: select "Any iOS Device", Product → Archive, then in the
Organizer: Distribute App → App Store Connect → Upload. The owner signs. Confirm the
uploaded build number matches what resubmit.sh set.

## Step 4 — App Store Connect (owner-run, you guide)
  - New version record if marketing version changed.
  - "What's New" in BOTH locales (Hebrew is default): draft he + en copy for the
    owner to paste; keep it truthful to what shipped (per-role home surfaces, the
    Command Center board, display pairing, the custody-focused student experience).
  - Screenshots: refresh per-role / per-surface shots if the UI changed materially.
  - App Review notes: state plainly this is a REAL native app (distinct native
    surfaces — mobile floor, iPad, Command Center board — NOT a web wrapper; App
    Review 4.2 mitigation) and provide an ISOLATED reviewer account: a dedicated
    least-privilege demo login in a SEPARATE clinic/tenant seeded with SYNTHETIC
    data only (no real client/patient/device records), scoped so the reviewer can
    exercise Code Blue + custody. Never point App Review at a production clinician
    account. Rotate/revoke the credential once the review completes.
  - Submit for review — only after the release quality gate (see notes) is clean.

## Step 5 — After upload
Update ios/.last-shipped-build to the uploaded build number and commit it (the
resubmit script prints this reminder), so the next verify:resubmission floor is right.

## Guardrails
  - Never a plain `pnpm build && npx cap sync` — always `pnpm cap:build:native`.
  - Never hand-edit MARKETING_VERSION / CFBundleVersion / package.json version —
    always the resubmit script.
  - Native builds must stay real native surfaces, never a CAPACITOR_SERVER_URL web
    wrapper (App Review 4.2 + social OAuth).
  - Don't enter the owner's Apple credentials or signing secrets yourself — direct
    the owner to do the credentialed steps.

═══ PROMPT ENDS ═══
```

## Notes for the owner

- The **live tri-display audit** (`live-tri-display-audit-prompt.md`) is the release *quality* gate; this prompt is the release *mechanics*. It is **required**: run the audit and confirm it comes back **clean (zero BLOCKING/HIGH)** before submitting. Submitting without a clean audit requires an explicit, owner-approved exception recorded in `docs/audit/PROOF_ALIGNMENT_LOG.md` — never a silent skip.
- `pnpm verify:resubmission` is the load-bearing gate — it re-bases the old fixed `>= 4` build floor to "strictly greater than `ios/.last-shipped-build`," so it will refuse a stale build number. Update `ios/.last-shipped-build` after every successful upload.
- Full runbook detail (both modes + the build-number tracker) lives in `RESUBMISSION_RUNBOOK.md` §B.1.
