# VetTrack 1.2.0 (build 26) — resubmission owner runbook

State as of this session. App is LIVE (store version **1.0.1**); this ships **1.2.0 / build 26**.
ASC app id `6778937527` · **1.2.0 version id `750d3540-a267-4e47-aca8-6c3814abba4c`** (PREPARE_FOR_SUBMISSION) · he localization id `cc104529-1988-4ab8-8361-bf0dfd054aa4`.

## Done (automated this session)
- ✅ All audit fixes committed on `claude/resubmission-audit-fixes` → **PR #116** (1 critical + 13 moderate + lows). Gates green (typecheck 0, 57/57 tests, 0 cycles, verify-resubmission build 26>25).
- ✅ Native shell **rebuilt** from the fixed tree → `ios/App/App/public` now carries the fixes (ready to archive).
- ✅ ASC **1.2.0 version created** (copied description/keywords/URLs from 1.0.1) + **Hebrew "What's New" set** (469 chars). Store stays Hebrew-only (matches 1.0.1).
- ✅ Review-notes copy drafted → `docs/release/metadata/1.2.0/whats-new-and-review-notes.md`.
- ✅ **Review details already complete on ASC** (contact + demo account `reviewer@vettrack.uk` + password + notes) — verified via `asc review details-for-version`. No CLI action needed.
- ✅ **iPhone screenshots replaced** — 5 fresh **Hebrew, branded** shots (home · code-blue · crash-cart · equipment · alerts) generated from the live app, dev QA/E2E fixtures stripped, uploaded to `APP_IPHONE_67` (1290×2796, accepted for the 6.9″/6.7″ slot). Replaced the prior 3 English/stale-UI shots. Source + repro: `docs/release/metadata/1.2.0/screenshots/`. **iPad set left as-is** (3 existing English shots — owner deferred a Hebrew iPad refresh).

## Owner steps to finish (in order)

### 1. Merge PR #116 → deploys the SERVER fixes
The critical deletion carve-out, `/me preferredLocale`, push VAPID gate, anonymize live server-side — they only reach prod on merge (CI deploy). Drive #116 to green + CodeRabbit, then merge.

### 2. Pre-archive gates (needs your secrets)
```bash
read -rs REVIEWER_PASSWORD; export REVIEWER_PASSWORD   # paste demo password — not echoed, not stored in shell history
pnpm verify:resubmission     # expect PASS incl. LOGIN: complete (build 26 > 25 already passes)
```
- If demo-login ≠ `complete` → Clerk **Client Trust** re-enabled (§G): Dashboard → Configure → Updates → revert. (#1 re-rejection risk.)
- Confirm Railway `VAPID_PUBLIC_KEY`+`VAPID_PRIVATE_KEY` are BOTH set or BOTH unset (never public-only).
- Reviewer account `reviewer@vettrack.uk`: role **vet / senior-technician** (NOT admin) in the demo clinic, with an **active roster shift spanning the review window** (import a wide date range — rostering is admin-CSV-only; unrostered → silent 403 on Code Blue).

### 3. Archive + upload build 26 (Xcode — your signing)
```bash
pnpm cap:open:ios     # shell already rebuilt in step Done
```
Xcode → "Any iOS Device" → Product ▸ Archive → Organizer ▸ Distribute App ▸ App Store Connect ▸ Upload. Wait for build 26 → **VALID** in TestFlight/ASC.

### 4. Attach build + review details + screenshots + submit
Once build 26 is VALID:
```bash
export ASC_APP_ID=6778937527
# attach the processed build (THE ONLY REMAINING BLOCKER per `asc validate`)
asc versions attach-build --version-id 750d3540-a267-4e47-aca8-6c3814abba4c --build <BUILD_26_ID>
# Review details: ALREADY COMPLETE on ASC (contact Dan Erez + demo reviewer@vettrack.uk + password + notes).
#   Verified via `asc review details-for-version --version-id 750d3540-…`. No action needed.
# Screenshots: ALREADY DONE — 5 Hebrew branded iPhone shots live in APP_IPHONE_67 (01→05),
#   3 existing iPad shots retained. Re-verify anytime with:
#   asc screenshots list --version-localization cc104529-1988-4ab8-8361-bf0dfd054aa4
asc validate --app 6778937527 --version 1.2.0 --platform IOS --output table   # after attach: expect 0 blocking
```

### 5. Submit (irreversible — your call)
```bash
asc publish appstore --submit --app 6778937527 --version 1.2.0     # or: asc review submissions-create/submit
```

### 6. After a successful upload
```bash
echo 26 > ios/.last-shipped-build && git add ios/.last-shipped-build && git commit -m "chore: last-shipped build 26"
```

## Open owner-decisions (from the audit, not blockers)
- Clinic-less fresh Apple ID still 403s `MISSING_CLINIC_ID` on delete (pending case IS fixed). Needs Clerk org auto-enrollment OR a clinic-less self-delete route (borders §F) — decide before relying on the reviewer creating a brand-new Apple account with no clinic.
- Adding an English store localization (currently Hebrew-only) — product decision.
