# Device Audit — Consolidated Audit × 10x, Phases 0–2 (2026-07-13)

**Method:** on-device behavioral audit of the **native Capacitor shell** running in the **iOS Simulator**, driven via computer-use with screenshot + backend (DB/API) cross-checks per the E2E rule. Playbook: `docs/audit/phase-0-2-device-audit-playbook.md`.

| | |
|---|---|
| Audit target | `main` @ `b6856f921` (PR #86 merge). ⚠ shared worktree advanced to `2a200cdf0` and back under the audit (concurrent agent) — both commits contain the audited features. |
| App under test | local `pnpm dev` (API `:3001`, web `:5000`), **dev-bypass** auth (admin, `dev-clinic-default`) |
| Native shell | Capacitor 8.4 (SPM), live-reload `CAPACITOR_SERVER_URL=http://localhost:5000`, `xcodebuild` on Xcode 26.5 |
| Devices | **iPhone 17 Pro** (iOS 26.4) · **iPad Pro 11-inch M5** (iOS 26.4) |
| Locale | Hebrew (app default) |
| Scope run | **high-value subset** of the playbook drills (D12, D14, D16, custody/scan infra, nudge feed). Remaining drills **DEFERRED** — see coverage table; no card is implied-passed. |

---

## Resolution — fixes applied (PR #89, `fix/device-audit-findings`, 2026-07-13)

| Finding | Outcome |
|---|---|
| **F-1** i18n (return dialog English on Hebrew app) | **FIXED** — `return-plug-dialog.tsx` localized to `t.returnPlugDialog.*` (en+he parity; interpolated strings via `tr()`). RED test `return-plug-dialog-i18n.test.tsx` renders the Hebrew dialog + asserts no English literal. |
| **F-3** custodian summary stale after return | **FIXED** — `invalidateAll()` now invalidates `["equipment-truth", id]` + `["deployability", id]`. RED test in `return-damaged.test.tsx`. |
| **F-2** damaged-return third button on-device | **SOURCE VERIFIED · on-device INCONCLUSIVE** — the button code is unconditional + `return-damaged.test.tsx` 4/4 + renders in jsdom, so the *source* is correct; the on-device non-render is **most likely** a WKWebView bundle-cache artifact but was **not** re-confirmed on a clean `cap:build:native`. No code change. |
| **F-4** iPad redundant nav | **REFUTED** — `NativeShell.tsx:61-103` renders the tablet branch with only `NativeTabSidebar`; `NativeTabBar` is phone-only (L136). The bottom bar seen was the adjacent iPhone-simulator window. No code change. |
| **Role-onboarding** (owner request) | **SHIPPED** — two-option chips (vet/tech), vet gated on a doctor/license number, auto-promote-on-approval with admin override + `422 VET_LICENSE_REQUIRED` gate, migration 163. **Security-relevant:** this intentionally reverses the prior advisory-only role guard (T24b) — mitigated by the vet/tech self-select cap (`sanitizeRequestedRole` + resolver boundary), vet license verification, and the admin approve/reject/override gate. Unit-covered (approval-role, role-chips, pending-users, provisioning). |

**Verification status:** full vitest suite **537 files / 4766 tests green**; both typechecks 0; i18n parity + no-Hebrew-in-source; architecture gates (G1); migration 163 applied + approve-as-vet round-trip. **On-device re-confirmation of the return dialog + the deferred-drill sweep (D) were blocked by the simulator's Hebrew-IME text-entry friction** (the documented environment limitation from this audit) — the app loads and renders correctly on the fixed bundle, but driving the checkout→return flow to open the dialog on-device was not completed. The changes are comprehensively unit-verified; the full device sweep remains for a session with reliable device text entry (or a clean bundled build).

---

## Verified PASS (on-device)

### D12 · Locate search (T-22) — PASS (full E2E, iPhone)
- Map-pin FAB → `LocateSearch` bottom sheet ("איתור ציוד"). Empty state shows a **helper** ("search by name/location/holder"), a non-matching query shows a distinct **"no equipment found"** — the `T-22c` *empty ≠ zero-results* requirement, confirmed both ways.
- A matching query returns result rows each showing **location · custodian · readiness** ("E2E Test Equipment — unknown · none · unknown"); tapping a row **deep-links to the equipment detail**.
- **Backend cross-check:** `GET /api/equipment/locate?q=…` returns the evidence-graph composition (`results[].{location,custodian,readiness}` with confidence + citations), `clinicId`-scoped. `T-22a` compose route confirmed.
- Evidence: `iphone-D12-locate-results.png`, `iphone-D12-deeplink-detail.png`.

### D16 · Start-of-shift card (T-27) — PASS (idle variant, iPhone)
- The `StartOfShiftCard` renders on the admin home as the **idle** composition: "אין כרגע דבר שדורש תשומת לב" ("nothing currently requires attention"). Matches `T-27a`'s off-shift/idle variant.
- Evidence: `iphone-home-D16-idle-nudge-locate.png`.

### D14 · Return releases custody — PASS (return path) + LOGIC PASS (damaged variant)
- **Return path (device):** checking out QA Test Monitor → detail exposes **"החזרה" (Return)** → `ReturnPlugDialog` → Confirm → green "הציוד זמין" toast; **backend confirms `custody_state: checked_out → returned`, in-use count 0**. Return releases custody end-to-end.
- **Owner decision (damaged-return releases custody):** **LOGIC VERIFIED** — `tests/return-damaged.test.tsx` **4/4 green**, incl. "custody stays released and reportDamage is never called" on undo, and the offline branch that surfaces a message instead of firing an online-only report. Code at `equipment-detail.tsx:1486-1514` matches.
- **On-device damaged path: INCONCLUSIVE.** The "Returned damaged" third choice did **not** render in the shell's `ReturnPlugDialog` (only the two plug-status choices), across multiple loads incl. a fresh app relaunch. The served module (`/src/components/return-plug-dialog.tsx`) **does** contain `btn-returned-damaged` + `allowDamagedReport`, the call site passes `allowDamagedReport` unconditionally, the i18n keys exist, and the unit test renders the button — so this is most likely a **Capacitor WKWebView bundle-cache artifact on the concurrently-mutated `main` worktree, not a source defect.** Follow-up: re-verify on a clean `pnpm cap:build:native` bundle.
- Evidence: `iphone-D14-pre-return-custodian-devadmin.png`, `iphone-D14-post-return-released.png`.
- Bonus: after **cancelling** the Return dialog, the Return button still re-opened it (the `T-04` "action survives a cancelled dialog" pattern).

### Custody state machine + scan infra — PASS (iPhone)
- Full lifecycle observed & DB-confirmed: `untracked → docked → checked_out → returned`, with the home coverage counters ("בשימוש"/in-use, "מושאלים"/borrowed) tracking live server state.
- The checkout gate correctly enforces its precondition: an `untracked` device returns **`CUSTODY_CHAIN_BROKEN` (422)** (root cause of the seed devices being un-checkoutable until given a `docked` baseline — a seed-data gap, not a Phase 0–2 defect).
- Scan flow: camera view + **manual-code fallback** ("הזן קוד ידנית") work in the simulator; `ScanResultCard` resolves equipment and its actions (check-out / mark-OK / report-fault) function; "mark OK" writes `lastVerifiedAt` (DB-confirmed).
- Evidence: `iphone-custody-established-1inuse.png`.

### Anomalies feed — compute-on-read live update — PASS (iPhone)
- Marking QA Monitor OK **immediately** dropped it from the "חריגות" (exceptions) list: badge **2 → 1**, bell **2 → 1**, no manual refresh. Compute-on-read behavior confirmed.
- ⚠ Scope note: this is the **stale-scan** anomalies feed, which is **distinct** from the `T-30` expiry/restock **nudge** feed — the latter was not separately isolated this session (see DEFERRED).
- Evidence: `iphone-nudge-exceptions-decrement-2to1.png`.

---

## Findings

### F-1 · i18n leak: Return dialog is hardcoded English on a Hebrew app — MEDIUM
`src/components/return-plug-dialog.tsx` renders its plug-status copy as **hardcoded English string literals** — "Return Equipment" (L89), "Was … plugged in after returning?" (L92-93), "Plugged In" (L110), "Not Plugged In" (L124), "Confirm — Plugged In ✓" (L185), "Cancel", "Alert deadline (minutes)" (L143), and the amber "An alert will be sent after N minutes…" (L110-ish). Only the *new* damaged copy (`t.returnPlugDialog.damagedButton` / `damageWarning`) is localized. On the Hebrew-default clinical app the entire return dialog therefore appears in English.
- **Failure scenario:** a Hebrew-only technician opens Return on any checked-out device and sees an all-English dialog.
- **Likely pre-existing** (the dialog predates Phase 0–2); surfaced by the device audit. Note: `tests/i18n-no-hebrew-in-source.test.ts` catches *Hebrew* literals in source but nothing catches *English* UI literals, so this class slips through.

### F-2 (follow-up, not a confirmed defect) · Verify the damaged-return button on a clean native build
See D14 above — the "Returned damaged" choice did not render on-device despite present source + passing test. Re-verify on `pnpm cap:build:native` (bundled shell) or after a hard WKWebView cache clear to distinguish a runtime gating bug from the observed bundle-cache/HMR artifact on the shared worktree.

---

## Coverage table (T-01 … T-44)

| Cards | Disposition |
|---|---|
| **T-22** locate | ✅ PASS (D12, iPhone) |
| **T-27** start-of-shift | ✅ PASS — idle variant (iPhone) **+ iPad hero-band variant** (on-shift variant DEFERRED) |
| tablet master-detail | ✅ PASS (iPad Equipment list → detail pane; sidebar nav) |
| **T-24** damaged-return custody | ✅ LOGIC PASS (test) · return path PASS · ⚠ on-device damaged button INCONCLUSIVE (F-2) |
| **T-04** return-after-cancel | ✅ PASS (observed incidentally on equipment-detail) |
| custody/scan infra | ✅ PASS (state machine, gate, scan, mark-OK) |
| anomalies feed | ✅ PASS (compute-on-read decrement) |
| **T-30** expiry/restock nudge | ⚠ PARTIAL — anomalies feed live-update seen; expiry/restock nudge not distinctly isolated → DEFERRED |
| **T-03** QR decode race | ⚠ CANNOT-VERIFY (sim has no camera; race needs injected timing) — manual-entry path works |
| **T-01** code-blue outcome cancel | ⏳ DEFERRED |
| **T-02** dock-return/RFID mount | ⏳ DEFERRED |
| **T-05** sync-engine wiring | ⏳ DEFERRED (indirect) |
| **T-06…T-16** submission gate / exit drill | ⏳ DEFERRED (owner/config; T-16 drill not run) |
| **T-17…T-21** equipment fixes | ⏳ DEFERRED |
| **T-23** readiness badge | ⏳ DEFERRED (status pills seen on list; ReadinessBadge not distinctly verified) |
| **T-25/T-26** shift-chat | ⏳ DEFERRED |
| **T-34…T-44** native-reachable MED | ⏳ DEFERRED |
| **T-36** sync-status-banner | ⏳ DEFERRED (needs injected sync error) |
| **T-37** sw-update-banner | ⚠ CANNOT-VERIFY in native shell (SW/PWA concern → `pnpm test:playwright:phase9`) |

### iPad pass (iPad Pro 11-inch M5) — tablet-divergent surfaces PASS

- **Tablet shell (NativeTabSidebar):** the iPad renders a full **right-side navigation sidebar** (Home/Equipment/Scan/Emergency/Tasks/Rooms/My-equipment/Alerts/Inventory + Management + Account) instead of the phone's bottom tab bar. RTL-correct (sidebar on the right). Evidence: `ipad-home-sidebar-bento-startofshift.png`.
- **Two-column bento home + richer StartOfShiftCard (T-27 iPad variant):** home is a two-column layout; the `StartOfShiftCard` is the fuller "hero band" variant ("אין משמרת פעילה" / no active shift + browse-equipment CTA) vs the phone's one-line idle card. Confirms the plan's phone-compact / iPad-hero divergence.
- **Equipment master-detail:** the Equipment screen is a genuine master-detail — master list on the right, detail pane on the left with a **"בחר פריט" (Select an item)** empty state; selecting a row loads its detail **into the pane** while the list stays visible (not a full-screen push). Evidence: `ipad-equipment-master-detail-empty.png`, `ipad-equipment-master-detail-loaded.png`.

**iPad observations (minor):**
- **F-3 · Post-return custodian staleness (also seen on iPhone) — LOW.** After returning a device (`custody_state: returned`, DB-confirmed), the detail view's **"אחראי" (responsible)** field still shows the prior holder ("Dev Admin") instead of unassigned. The Return button correctly disappears, so custody *is* released server-side — the detail-view custodian text just doesn't refresh. Minor UI cache-invalidation nit on both devices.
- **F-4 · Possible redundant navigation on iPad — LOW (verify).** The iPad appeared to render **both** the right sidebar **and** a bottom tab bar simultaneously. Could not fully disambiguate the bottom bar from the adjacent iPhone-simulator window; flag to confirm on a single-window capture.

---

## Environment caveats (affect interpretation)
1. **Shared, concurrently-advancing `main` worktree** — HEAD moved `b6856f921 ↔ 2a200cdf0` mid-audit (another agent). Both carry the audited features; but this is why the WKWebView bundle staleness (D14) is ambiguous.
2. **WKWebView live-reload ≠ guaranteed-current** — HMR did not reliably reach the backgrounded native web view; an explicit app relaunch was needed to pin the bundle.
3. **Hebrew IME** blocked Latin/UUID text entry in fields — worked around via clipboard-paste (seed-char → select-all → paste) and all-digit input.
4. **Thin seed** (2 equipment, 0 rooms) — rooms created + a `docked` custody baseline set via the dev-bypass API/DB to unblock custody drills (additive, dev tenant only).
5. **Report-only** — no source changes; the one runtime data change was additive test data in `dev-clinic-default`.
