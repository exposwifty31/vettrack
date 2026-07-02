# Shift Logic Rework — Plan

Status: **Phase 1 complete** (2026-07-02). Phase 0 done; Phase 1 done (increments 1–3: backend, authority wiring, frontend). Phase 2 parked (no EZShift export). Outstanding: mobile/tablet/RTL/dark visual pass of the new affordances. See Open Items.

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

### Phase 1 — Shift-**adjustment** request → admin approval layer (decided 2026-07-02)

Model (from the user): a rostered person **requests** a deviation with a **required reason**; an **admin approves** it. No self-service override. Two symmetric directions: **extend** (work past the rostered end) and **leave_early** (leave before it). Only an **approved** request moves the person's effective shift window; the **role never changes** (a deviation is not a promotion). The Today hero "End Shift" button becomes an **"end shift early"** (leave_early) request — the roster model has no clock-out, so it never actually ended a shift.

- **Increment 1 — backend — DONE (`a6e223aa`).** Table `vt_shift_adjustments` (+ migration 156): `id`, `clinicId`, `requesterUserId`, `requesterName`, `kind` (`extend | leave_early`), `baseShiftDate`, `baseShiftId?`, `currentEndTime`, `requestedEndTime`, `reason` (required 3–500), `status` (`pending | approved | rejected | cancelled`), `decidedByUserId?`, `decidedAt?`, `decisionNote?`, `createdAt`. Route `/api/shift-adjustments` (registered in `app/routes.ts`): `POST` create (must be on a roster shift; reason required; overnight-aware direction check; one pending per shift/day), `GET ?status=` (admin: all; requester: own), `PATCH :id` (admin-only approve/reject), `POST :id/cancel` (own pending). Four new `AuditActionType` members. Pure overnight-aware helper `shift-adjustment-window.ts`.
- **Increment 2 — authority wiring — DONE (`b5f573f0`, frozen surface).** `resolveCurrentRole` consults **approved** adjustments **additively** via fail-safe `resolveEffectiveShift`: `leave_early` shortens the active window (off-shift once the earlier effective end passes); `extend` prolongs it (on past the rostered end while the extended window covers `now`). Precedence: approved-and-active adjustment `requestedEndTime` → roster `vt_shifts` end → none. **Byte-identical** when no userId / no approved row / query throw. Gated by `tests/role-resolution-adjustments.test.ts` (reference-identity assertion + 5 cases + 2 fail-safe) and a real-Postgres probe of the 5 cases; Strategy-A invariant holds.
- **Increment 3 — frontend + i18n — DONE (`1afe855b`).** On-shift home hero gained **"Request extension"** and **"End shift early"** affordances (bottom sheet: new end time + reason → `POST /api/shift-adjustments`), shows the requester's own pending/approved status, and lets them cancel a pending request; the admin surface (`admin.tsx`) gained a **Shift requests** tab (pending-count badge + approvals list with reason and Approve/Reject); typed `api.shiftAdjustments` + `src/types/shift-adjustments.ts`; new `shiftAdjustments.*` `en.json`/`he.json` keys (parity enforced, registered in the hand-built accessor). **This fixes the reported "End Shift" bug** — the button no longer misroutes to the handover summary. Live browser E2E confirmed request → admin approve → effective-window update. Outstanding: mobile/tablet/RTL/dark visual pass. **Phase 1 is complete.**

### Phase 2 — Import hardening — **PARKED** (no EZShift export available)
The user has no export file to share. The generic CSV importer (`server/routes/shifts.ts`, Hebrew header variants) stays as-is. Revisit only if/when a real `.csv/.xlsx` export appears: confirm column mapping, handle **start-only** shifts via a shift-type→duration map, add a matched/unmatched preview, and import-time timezone handling.

## Frozen-surface guardrails

- `authority.ts` Strategy A stays **byte-for-byte** for existing (no-override) inputs.
- `ClinicalRole` / `ActiveShiftRole` closed unions unchanged (lead_technician stays aliased to senior_technician).
- An **approved adjustment** is **additive** and, because it affects the authority-relevant window, is guarded by a **byte-identical no-adjustment** regression test (reference-identity on the no-adjustment path) — **DONE** (`b5f573f0`, `tests/role-resolution-adjustments.test.ts`). `resolveEffectiveShift` is fail-safe: any resolver throw degrades to the pure roster snapshot, so a bug here can never block a clinical mutation.
- The Phase 0 home rewire is presentation-only and safe. **Phase 0 is DONE** (`66057889`).

## Open items

1. **EZShift export file** — none available; Phase 2 parked (see above).
2. ~~**Authority semantics of an approved extension**~~ **RESOLVED (user, 2026-07-02):** an approved adjustment **extends/contracts the effective clinical-authority window** — the person keeps their on-shift role for the approved hours (extend) or loses it early (leave_early); role unchanged. Wired in increment 2 (`b5f573f0`).
3. ~~**"End Shift" / "Start Shift" hero buttons**~~ **RESOLVED (user, 2026-07-02):** the "End Shift" button becomes an explicit **leave_early request** (symmetric with extend). Remaining work is increment 3 (frontend): the hero affordance replaces the misleading `/handoff` navigation. "Start Shift" stays a handover entry point.

## Verification (per phase)

`pnpm typecheck` · `pnpm i18n:check` · `pnpm test` · native rebuild + on-device check (on-shift, off-shift, and an extension) · log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md`.
