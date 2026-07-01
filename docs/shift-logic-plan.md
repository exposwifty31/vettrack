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

### Phase 1 — Override / extend layer (Approach 1)
- Schema `vt_shift_overrides` + migration.
- API: `POST /api/shifts/override` (extend/adjust), plus the effective-shift read.
- `role-resolution`: consult override → roster (additive).
- `home.tsx`: an **"extend shift"** affordance (self); manager path under admin/shifts.
- Enforcement review + byte-identical no-override regression test.

### Phase 2 — Import hardening (needs the real EZShift export)
- Confirm the actual export columns map to the importer; handle **start-only** shifts via a shift-type→duration mapping if EZShift omits the end.
- Name-match safeguards: preview shows matched vs. unmatched people before confirm.
- Timezone handling on import.

## Frozen-surface guardrails

- `authority.ts` Strategy A stays **byte-for-byte** for existing (no-override) inputs.
- `ClinicalRole` / `ActiveShiftRole` closed unions unchanged (lead_technician stays aliased to senior_technician).
- The override is **additive** and, because it affects the authority-relevant window, goes through the enforcement envelope + tests.
- The Phase 0 home rewire is presentation-only and safe.

## Open items (blockers for Phases 1–2)

1. **The actual EZShift export file** (.csv/.xlsx) — the screenshots are the app UI, not the export columns. Needed to finalize import mapping (esp. start-only vs. explicit end).
2. **Who may set an override** — recommend **self** (extend own current shift) **+ managers** (senior_technician+/admin extend anyone). Confirm.
3. **On extension, keep the same role** (recommended — no role change via extension). Confirm.

## Verification (per phase)

`pnpm typecheck` · `pnpm i18n:check` · `pnpm test` · native rebuild + on-device check (on-shift, off-shift, and an extension) · log evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md`.
