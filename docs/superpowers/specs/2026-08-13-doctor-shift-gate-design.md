# Doctor Shift Gate + Board Responsibles — Design

**Date:** 2026-08-13 · **Status:** Approved by owner (brainstorming session)
**Parent effort:** TV ward-board redesign (issue #9 follow-on). This spec covers the
*data source* for the board's "responsibles" block; the full TV visual redesign is a
separate follow-on design.

## Problem

The redesigned TV department board must show a daily responsibles roster — ICU senior
doctor, admission doctors, internal-medicine doctors, senior technician, equipment
coordinator — plus who is on shift now. Technician shifts are imported from EZShift,
but **doctor shifts have no real-world data source**: EZShift exports technicians
only, there is no published doctor roster we control, and the existing
`vt_doctor_shifts` CSV import pipe has no feed. The role taxonomy in code
(`admission | ward | senior_lead | night_*`) does not match the hospital's actual
structure and `senior_lead` does not exist in reality.

**Hospital reality (owner-confirmed):** three doctor teams — ICU, admission
(קבלה), internal medicine (פנימית) — each led by a rotating senior + ~3-4 doctors.
Evening: internal medicine not physically present. Night: one ICU + one admission
doctor. Seniors rotate between teams day-to-day.

## Decision summary (all owner-approved)

1. **Self-service gate on the existing clinical check-in mechanism** — not a new
   table, not a roster import. A vet-role user opening the app is asked "are you on
   shift?"; answering yes opens a `vt_clinical_check_ins` row carrying their team
   and senior status. All platforms read open check-ins.
2. **Senior eligibility is an admin-set profile flag** (`senior_doctor_eligible`),
   marked in the same admin screen used for secondary-role at signup approval. It is
   deliberately **not** a `secondaryRole` value — `secondaryRole` belongs to account
   RBAC and is never consulted by the clinical-authority path; overloading it would
   bleed a display/eligibility concept into permissions. Same pattern as the
   equipment-coordinator eligibility flag.
3. **Which team a senior leads is chosen per check-in**, not fixed in the profile.
   "ICU senior now" = open check-in with team=icu AND senior=true. Seniors rotate
   freely with zero admin upkeep.
4. **Forgotten checkout:** doctor check-ins auto-expire after 14 h (longer than any
   shift); the gate re-asks on next app open.
5. **Phase B (deferred, separate design):** "not on shift → technician-equivalent
   permissions". Explicitly out of scope here — it changes vet authority semantics
   (`actOffShift` exists today) and is not needed for the board.

## Design

### 1. Gate flow (client)

- **Audience/trigger:** vet-role users only, on app entry, only when they have no
  open check-in. Others never see it.
- **Step 1 — "האם אתה במשמרת?"** chips: כן / לא.
  - לא → dismissed; not asked again for 8 h (local snooze). No permission change
    (phase B).
  - כן → step 2.
- **Step 2 — "באיזה תפקיד?"** three large buttons: ICU / קבלה / פנימית. Above
  them, only for `senior_doctor_eligible` users: toggle **"אני הבכיר האחראי"**
  (default off). Tapping a team button commits immediately — no separate confirm.
  Two taps total for a regular doctor (כן → team), three for a senior
  (כן → toggle → team).
- **Senior conflict (per team):** if the chosen team already has an open senior,
  confirm-replace dialog ("ד"ר כהן כבר מסומן כבכיר ICU — להחליף אותו?"). On
  confirm, the previous senior keeps their open check-in but loses the senior tag.
  One senior max per team at any moment.
- **Status + exit:** home/profile shows "במשמרת — ICU (בכיר)" with **סיום משמרת**
  and **שינוי תפקיד** actions. Role change = close+open in one transaction (no gap
  on the board).
- **Where built — BOTH clients, mandatory (owner decision 2026-08-13):**
  1. The live Capacitor/web codebase (serves all four platforms today).
  2. The RN successor app (`VetTrack-RN-Migration`) via a **required companion
     PR** — same flow, same server endpoints. Not optional: the RN app is the
     store-submission vehicle; without the gate there, doctors on RN never feed
     the board. The server work lands once (vettrack repo) and serves both.
  Delivery order: server → Capacitor/web gate → RN gate; the feature is not
  "done" until the RN companion PR is merged.

### 2. Server + data

- **Migration A:** `vt_users.senior_doctor_eligible boolean NOT NULL DEFAULT false`.
  Surfaced in the existing admin user-management/approval UI next to secondary
  role.
- **Migration B:** `vt_clinical_check_ins.is_senior boolean NOT NULL DEFAULT false`.
  New `operationalRole` values for doctors: `icu` / `admission` /
  `internal_medicine` (existing column, today unused for vets).
- **Validation:** server rejects `is_senior=true` unless the caller's
  `senior_doctor_eligible` is set — client hiding the toggle is UX, not security.
- **Replace-senior:** opening a check-in with `is_senior=true` for a team that
  already has an open senior requires an explicit `replaceSenior: true` param;
  the server then clears `is_senior` on the previous row (row stays open). Audited.
- **Role change:** close+open in a single transaction.
- **Auto-expiry:** a dedicated `doctorCheckInExpiryWorker`
  (`server/workers/doctorCheckInExpiryWorker.ts`, started from
  `start-schedulers.ts`) — open check-ins whose `operationalRole` is a doctor
  value and age > 14 h are closed with `checkOutReason='auto_expired'`.
  **Doctor rows only**; the existing `staleCheckInSweepWorker` stays untouched
  (frozen), and technician check-in behavior is unchanged (no
  authority-envelope change).
- **Audit:** new kinds added to the closed `AuditActionType` union (check-in via
  gate, senior replace, auto-expiry uses `checkOutReason`).
- **Multi-tenancy:** every query filters `clinicId` (existing indexes:
  `idx_vt_clinical_check_ins_clinic_open` covers the board read).
- **Explicit non-goals:** no permission changes, no new realtime event (the board's
  5 s snapshot poll is sufficient), no change to technician check-ins, no touching
  the frozen realtime/Code Blue surfaces.

### 3. Board consumption

- **Additive `responsibles` section on `GET /api/display/snapshot`:**
  - `doctors` — per team (`icu`/`admission`/`internal_medicine`): senior
    `{name, since}` + members `[{name, since}]`, from open check-ins.
  - `seniorTechnician` — from the current technician roster (`vt_shifts`), already
    in the snapshot path.
  - `equipmentCoordinator` — reuse `resolveShiftCoordinator` service directly (not
    HTTP).
- **Display contract (block 5 of the TV redesign):** five slots — בכיר ICU, בכיר
  קבלה, בכיר פנימית, טכנאי בכיר, אחראי ציוד. Senior name large; team members
  small beneath; each entry shows since-time ("מ-07:32") so staleness is visible.
- **Empty states, no drama:** unfilled slot → muted "לא סומן" (not red/blinking);
  members without a senior → small "אין בכיר מסומן" label; night-empty internal
  medicine → simply empty, no special-casing.
- **Freshness:** existing 5 s snapshot poll → phone check-in appears on TV within
  ~5 s.
- **Clinical Safety Officer check (passed):** snapshot stays never-cached; changes
  are additive read-only fields; zero contact with Code Blue paths, SW cache rules,
  or emergency transport.

## Testing

- **Unit/integration (vitest):** eligibility validation (reject non-eligible
  `is_senior`), per-team senior uniqueness + replace semantics, close+open role
  change atomicity, 14 h doctor-only expiry (technician rows untouched), snapshot
  `responsibles` assembly, clinicId scoping.
- **E2E (Playwright):** gate appears only for vets without an open check-in; full
  yes→team→senior flow lands on the board snapshot; "לא" snoozes.
- **TDD:** failing test before each implementation slice, per house rules.

## Open items (deliberately deferred)

- Phase B: off-shift vets demoted to technician-equivalent permissions (separate
  brainstorm + Security Master review).
- Real doctor-roster import, if a published roster ever materializes (the existing
  CSV pipe layers on top without breaking the gate).
- Full TV board visual redesign (parent brainstorm — next step after this spec).

(RN-app gate parity is NOT an open item — it is a mandatory deliverable; see
"Where built" in §1.)
