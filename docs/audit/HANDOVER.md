# Handover — VetTrack wet-check audit (2026-07-05)

**For:** the next coding agent/CLI working in `vettrack-ship`.
**Full report:** [`docs/audit/WETCHECK_AUDIT_2026-07-05.md`](./WETCHECK_AUDIT_2026-07-05.md)
**Wet-check tooling:** `scripts/wetcheck/` (`seed.ts`, `simulate.mjs`, `cleanup.ts`, `prepare-real-db.ts`, `wetcheck-ezvet-shifts.csv`, `results-*.json`)

## What was done
A prior audit ran a full codebase + origin review, a logic-path dry-check of every major flow, and a scripted 24-hour shift simulation (82 checks, 74 passed) against a throwaway `vettrack_wetcheck` DB on port 3101. The real dev DB (`vettrack`) and running server (3001/5000) were never modified; the throwaway DB was dropped.

## Confirmed findings (act on these)

### P0 — Quick-scan bypasses waitlist reservation AND readiness gate  (HIGH)
`quickScanEquipmentCustody()` in `server/services/equipment-custody-toggle.service.ts` goes straight to `performEquipmentCheckout()` — it never calls `assertWaitlistCheckoutAllowed()` or `evaluateCheckoutV1Preconditions()`, unlike `toggleEquipmentCustody()`. So `POST /api/equipment/scan` lets any user take a unit reserved for a waitlisted user, and take a `not_ready`/staged unit.
- **Runtime proof:** with beta holding a reservation on a unit, `/checkout` by admin → `409 WAITLIST_RESERVATION_HELD_BY_OTHER`; `/api/equipment/scan` by admin → `200 {action:"checkout"}` (unit stolen).
- **Fix:** make `quickScanEquipmentCustody()` mirror the gates in `toggleEquipmentCustody()` (call `assertWaitlistCheckoutAllowed()` + `evaluateCheckoutV1Preconditions()` before checkout), or gate `/api/equipment/scan` behind a pilot flag and route production NFC through `/toggle`. Add a regression test: reserved unit + quick-scan by non-reserved user → expect denial.

### P1 — Body-parser errors return 500 instead of 413/400  (MEDIUM)
`server/index.ts:261` `app.use(express.json())` sets no `limit` (defaults 100 KB) while the multer upload path allows 5 MB. Oversized or malformed JSON bodies throw and hit the blanket-500 terminal handler (`server/index.ts:372–376`).
- **Runtime proof:** 5,000-row CSV posted as JSON → 500; malformed JSON body → 500.
- **Fix:** set an explicit `express.json({ limit })` consistent with the upload path, and special-case body-parser errors in the terminal handler (`entity.too.large` → 413, `SyntaxError`/`entity.parse.failed` → 400).

### P2 — Shift CSV silently drops unrecognized Hebrew role labels  (LOW)
2 of 9 rows (night/student label variants) were skipped into `issues` but a bulk confirm still imports the rest silently. Widen `detectDoctorOperationalShiftRole` coverage; surface skipped-row count at confirm.

### P2 — Waitlist reservation is "hollow" for asset-typed gear  (INFO)
After a return, an asset-typed unit resets to `readiness=unknown`; the promoted user can't `/checkout` until dock-return re-verification, yet the reservation TTL keeps ticking. Consider pausing/extending TTL during re-verification, or promoting only when `ready`.

## Also worth doing
- Reconcile the unmerged `cursor/*` bugfix branches into `origin/main` (several duplicate the 3 commits already ahead on the current branch); clear the `dependabot/*` backlog.
- Add teardown to the RFID/integration suites — the dev DB has accumulated ~9k orphan `rfid-test-*` rows across 376 test clinics.

## Real-DB readiness (do NOT skip the dry-run)
The local `vettrack` DB is essentially all test data (9,478 equipment / 563 clinics) and does **not** contain `danerez5@gmail.com` (that account is in Clerk-backed production). To prep a real environment:
1. `DATABASE_URL=… tsx scripts/wetcheck/prepare-real-db.ts`   (dry-run, changes nothing — review the plan)
2. `CONFIRM_PURGE=1 DATABASE_URL=… tsx scripts/wetcheck/prepare-real-db.ts --execute`   (irreversible)
The script preserves `danerez5@gmail.com` and any clinic it can't confidently classify as test (~187 clinics are left untouched — extend `TEST_CLINIC_LIKE` if those are also test).

## Suggested first task
Implement the P0 fix (quick-scan gate parity) with a regression test, then P1. Follow repo rules in `CLAUDE.md` (TDD, `clinicId` on every query, run `npx tsc --noEmit` + `pnpm test`, commit per task).
