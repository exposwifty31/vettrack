# Shift Logic Rework — Plan

Status: **proposed** (2026-07-02). Awaiting: real EZShift export file + two override params (see Open Items).

## Goal

Make "on shift" reflect **reality per person**: the imported EZShift **roster is the schedule baseline**, and an in-app **override/extend** layer captures deviations (a scheduled 8h shift extended to 12h; a person who came in on hours the manager never updated in EZShift). Also fix the home hero, which today reads an orphaned table and shows a stale multi-day "shift".

## Audit findings (verified 2026-07-02, adversarial workflow)

- **Three shift concepts exist.** `vt_shifts` (roster, name-based, role ∈ {technician, senior_technician, admin}) and `vt_doctor_shifts` (roster, userId-based, operationalRole) are populated by the CSV import (`server/routes/shifts.ts`). `vt_shift_sessions` (clock-in) is **never inserted by any app code** — created in migration 035, orphaned; the ~49-day production "shift" is manual/seed data.
- **The roster is the real "on shift now".** `server/lib/role-resolution.ts:110-131` matches the user by normalized name against the scheduled window (overnight-aware) and feeds authority Strategy A + the display board (`server/routes/display.ts` `currentShift`).
- **The home hero is wired to the wrong table.** `server/routes/home-dashboard.ts:28-32` reads `vt_shift_sessions` → the native/web discrepancy.
- **Additional real bugs found:** (a) timezone inconsistency — role-resolution uses server-local time, `display.ts` uses UTC, so they can disagree about who's on shift; (b) the shift-window SQL is duplicated across 3 files with byte-different variants; (c) name matching is a fragile normalized-string compare (no fuzzy/disambiguation); (d) the CSV import has no timezone handling and the doctor CSV has no preview.
- **EZShift = generic CSV importer** (Hebrew header variants); no EZShift-specific adapter.

## Decisions locked (from the user)

- **A.** "On shift" is **purely roster-derived** — no clock-in button. → `vt_shift_sessions` is retired.
- **C.** `lead_technician` **=** `senior_technician`. The existing alias is correct → **no role-differentiation work** (Audit B closed).
- **E.** Reconciliation = **Approach 1**: roster baseline + an in-app **override/extend** layer for deviations.
- **Domain (from EZShift screenshots):** shift *types* encode role + seniority (`בכיר`=senior→senior_technician; `אישפוז`/hospitalization, `חירום`/emergency, `קבלה`/reception, `תמך`/support, `לילה`/night, `מזכירות`/secretary). Times are often a **start only** with the end implied by the shift type; some rows carry an explicit range. EZShift itself marks extended shifts (⟳ icon + explicit range) but managers frequently don't update it — hence the override.

## Design

### Source-of-truth precedence

Effective shift for `(user, now)` = **override (if active) → roster (`vt_shifts`) → none**.

### New table: `vt_shift_overrides` (additive)

Per (clinic, user, date): `effectiveStartTime?`, `effectiveEndTime`, `sourceRole` (copied from the roster shift being extended), `createdBy`, `createdByRole`, `reason?`, `createdAt`.

- Only **extends/adjusts the time window** of an existing roster shift and **carries that shift's role** — it **never grants a new role** (no authority-escalation path).
- When **absent**, Strategy A is byte-for-byte identical to today (the override is a new input case, not a change to existing behavior).

### Authority interaction (the delicate part)

- `role-resolution` consults **override → roster** in its window match. So clinical authority **persists through a real extension** (correct — the person is actually working), but the **role never changes**.
- Additive contract: no override row ⇒ identical snapshot to today. Requires an enforcement review + a regression test asserting the byte-identical no-override path.

## Phases

### Phase 0 — Roster as the single source (fixes the reported bug; low risk, presentation-layer)
- `home-dashboard.ts`: replace the `vt_shift_sessions` query with a **per-current-user roster lookup** (reuse the role-resolution window logic). Return `{ shift: { startedAt: scheduledStart, endsAt: scheduledEnd, role } | null }`.
- `src/pages/home.tsx`: elapsed = now − scheduled start; surface "ends at"; remove the interim 24h guard.
- Deprecate `vt_shift_sessions` (stop reading it; drop in a later migration).
- **Timezone fix:** standardize role-resolution + `display.ts` on the clinic timezone (Asia/Jerusalem); extract the shift-window match into **one** shared helper (byte-identical output for the existing path). *Higher-risk — authority-adjacent; gate behind tests.*
- Verify: home agrees with the board; native shows correct on/off-shift.

### Phase 1 — Shift-extension **request → admin approval** layer (decided 2026-07-02)

Model (from the user): a person who needs to work past their rostered end **requests** an extension with a **required reason**; an **admin approves** it. No self-service override. Only an **approved** request extends the person's effective shift window; the **role never changes** (an extension is not a promotion).

- **Schema** `vt_shift_extension_requests` (+ migration): `id`, `clinicId`, `requesterUserId`, `requesterName`, `baseShiftDate`, `baseShiftId?` (roster row being extended), `currentEndTime`, `requestedEndTime`, `reason` (required, non-empty), `status` (`pending | approved | rejected | cancelled`), `decidedByUserId?`, `decidedAt?`, `decisionNote?`, `createdAt`.
- **API** (`server/routes/shifts.ts` or a new `shift-extensions.ts`, registered in `app/routes.ts`):
  - `POST /api/shifts/extensions` — requester creates a `pending` request; must currently be on a roster shift; `reason` required; validated.
  - `GET /api/shifts/extensions?status=` — admin sees all pending; a requester sees their own.
  - `PATCH /api/shifts/extensions/:id` — **admin only** approve/reject (+ optional note). Audited.
  - New `AuditActionType` members for request/approve/reject (closed union in `server/lib/audit.ts`).
- **Effective-shift precedence:** approved-and-active extension `requestedEndTime` → roster `vt_shifts` end → none. `role-resolution` consults approved extensions **additively**: with no approved extension the snapshot is **byte-identical to today**. Requires the byte-identical no-extension regression test + an enforcement review before merge.
- **Frontend:** on-shift home hero gains a **"Request extension"** affordance (sheet: new end time + reason) and shows the request's pending/approved status; the admin surface (`admin.tsx`) gains a **pending-extensions approvals list** (reason shown, approve/reject).
- **i18n:** new `en.json`/`he.json` keys (parity enforced).

### Phase 2 — Import hardening — **PARKED** (no EZShift export available)
The user has no export file to share. The generic CSV importer (`server/routes/shifts.ts`, Hebrew header variants) stays as-is. Revisit only if/when a real `.csv/.xlsx` export appears: confirm column mapping, handle **start-only** shifts via a shift-type→duration map, add a matched/unmatched preview, and import-time timezone handling.

## Frozen-surface guardrails

- `authority.ts` Strategy A stays **byte-for-byte** for existing (no-override) inputs.
- `ClinicalRole` / `ActiveShiftRole` closed unions unchanged (lead_technician stays aliased to senior_technician).
- An **approved extension** is **additive** and, because it affects the authority-relevant window, goes through the enforcement envelope + a **byte-identical no-extension** regression test.
- The Phase 0 home rewire is presentation-only and safe. **Phase 0 is DONE** (`66057889`).

## Open items

1. **EZShift export file** — none available; Phase 2 parked (see above).
2. **Authority semantics of an approved extension** *(confirm before wiring `role-resolution`)* — recommended: an approved extension **extends the person's effective clinical-authority window** (they keep their on-shift role for the approved extra hours; role unchanged). This is the whole point — a stale roster otherwise expires authority while the person is still working. Alternative: record/audit only, no authority effect.
3. **"End Shift" / "Start Shift" hero buttons** — in the roster-derived model there is no manual clock-in/out. Today's hero still shows Start/End Shift (→ `/handoff`), which opens the handover summary and does **not** end anything (user-reported 2026-07-02). Decide: remove the buttons, relabel to **"Handover"**, or add an explicit **leave-early** request. See investigation below / current chat.

## Verification (per phase)

`pnpm typecheck` · `pnpm i18n:check` · `pnpm test` · native rebuild + on-device check (on-shift, off-shift, and an extension) · log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md`.
