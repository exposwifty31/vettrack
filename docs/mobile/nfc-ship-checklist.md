# VetTrack — NFC ship checklist (TestFlight / release evidence)

**Purpose:** Human release gate for VetTrack **1.1+** NFC entry (Universal Links, quick actions, Control widget, logged-out toast, stale checkout nudge). Automated gates live in `scripts/verify-resubmission.sh` and unit tests; this document captures **device evidence** before App Store submission.

**How to use:** Install the candidate build from TestFlight. Execute each row on a physical iPhone with NFC. Mark PASS/FAIL and attach a screenshot or short note. All rows must PASS before archive submission.

**Prerequisites**

- [ ] `./scripts/build-native-shell.sh` run on the Mac used for archive
- [ ] `scripts/verify-resubmission.sh` exits 0 on the Mac used for archive
- [ ] `pnpm test -- tests/deep-link-router.test.ts tests/auth-guard-nfc-toast.test.tsx` green
- [ ] Test account signed out unless the row requires signed-in state
- [ ] At least one tagged VetTrack equipment item with a known UUID / NFC tag

---

## Automated gates (run on Mac before device matrix)

| Gate | Command / check | Result | Notes |
|------|-----------------|--------|-------|
| Resubmission script | `./scripts/verify-resubmission.sh` | PASS / FAIL | |
| Native shell build | `./scripts/build-native-shell.sh` | synced | `.env` Clerk + API origin; not dev-bypass |
| Deep-link unit tests | `pnpm test -- tests/deep-link-router.test.ts` | PASS / FAIL | |
| AuthGuard toast tests | `pnpm test -- tests/auth-guard-nfc-toast.test.tsx` | PASS / FAIL | |

---

## Device matrix (TestFlight)

| # | Scenario | Steps | Expected | PASS / FAIL | Evidence |
|---|----------|-------|----------|-------------|----------|
| 1 | Universal Link — **cold start** | Force-quit app. Open Safari → `https://vettrack.uk/equipment/<uuid>` (replace with real id). | App opens (or installs then opens); lands on equipment with NFC toggle intent (`nfcAction=toggle` in URL). Signed-in: custody toggles or blocked state shown. | | |
| 2 | Universal Link — **warm** | App in background. Tap same UL from Messages or Notes. | App foregrounds; same route as cold; no duplicate navigation flicker within ~1.5s. | | |
| 3 | Custom URL — scan shortcut | Force-quit. Open `vettrack://scan` (Shortcuts or Safari). | App opens to `/equipment?scan=1` (scanner entry). | | |
| 4 | iOS **Quick Action** (iOS 17+) | Long-press app icon → VetTrack scan action (if configured). | Opens scanner / equipment scan entry without crash. | | |
| 5 | **Control widget** tap | Add VetTrack Control widget → tap Scan. | App opens scan/toggle entry path; no blank WebView. | | |
| 6 | **Logged-out** NFC / UL toast (B1) | Sign out. Open UL or widget path that sets `nfcAction=toggle`. | Toast: sign-in-first copy (`nfcEntry.signInFirst`); no silent failure. | | |
| 7 | Logged-out toast dedupe (D6) | Repeat row 6 within 8 seconds. | Second attempt does **not** spam duplicate toasts. | | |
| 8 | Signed-in NFC toggle | Sign in as technician+. Scan tagged equipment (foreground NFC). | Online toggle POST succeeds; checkout/return reflected in UI; blocked if held by another user. | | |
| 9 | Stale checkout nudge | Check out equipment ≥12h (or lower `STALE_CHECKOUT_HOURS` in staging); wait for sweep/push. | Push notification received (if subscribed); at most 3 nudges per checkout episode. | | |

---

## Sign-off

| Role | Name | Date | Build (`CURRENT_PROJECT_VERSION`) |
|------|------|------|-----------------------------------|
| QA / release | | | |
| Engineering | | | |

**Release blocked if:** any device row FAIL; resubmission script FAIL; demo login not `complete` (see runbook §G).
