# medium-02 · Shift handover as a generated artifact

> Tier: Medium · Effort: Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Medium #5 · roadmap #5
> (`docs/design/product-growth-roadmap.md` sketches `vt_shift_handover`).

## Goal
At shift end, auto-generate "what changed this shift / what's still open" from the deltas
VetTrack already captures — a structured, acknowledged handover pushed to the incoming shift.

## Why 10x
Handover is high-frequency (every shift change, 2–3×/day) and today lossy/free-form. The data
already exists — this turns exhaust into a valued artifact, and creates a daily habit surface
(the incoming shift opens VetTrack first to read handover). Best effort-to-value ratio of the
Medium tier.

## Reuse (real anchors)
- `vt_shifts` / `vt_shift_sessions`; `server/routes/shifts.ts`, `shift-adjustments.ts`,
  `shift-chat.ts`; `src/features/shift-adjustments/*`, `src/features/shift-chat/*`.
- `vt_audit_logs` + `vt_event_outbox` — the delta sources (custody moves, task state, alerts,
  dispenses).
- `notification.worker` — push to incoming shift.
- Per-role home surfaces (`src/features/today/surfaces/*`) — where to surface it.

## Approach
1. New `vt_shift_handover` (`clinicId`, `shiftSessionId`, `openItems[]`, `deltas`,
   `acknowledgedBy`, timestamps).
2. A generator that runs at shift end and aggregates the shift's custody/task/alert/dispense
   deltas into a compact artifact + open-items list.
3. **New `/handoff` surface** (none exists today) rendering the artifact; an acknowledge action;
   push to the incoming shift.

## New schema / surfaces
- `vt_shift_handover` (+ migration).
- `/handoff` page (lazy route in `src/app/routes.tsx`) + a home-surface entry point.
- New `AuditActionType` for handover generate + acknowledge.

## Frozen constraints
- Standard feature checklist. `clinicId` scoped. Deltas read from existing audit/outbox — do
  not add a new realtime path.

## Verification
- Seeded shift with a known set of mutations → handover lists exactly those deltas + open items.
- Acknowledge records `acknowledgedBy`; incoming shift receives the push.
- RTL spot-check of the `/handoff` surface (default + empty + loading + error states).

## Effort / Risk
Medium. Risk: low — self-contained; the only real design choice is which deltas count as
"handover-worthy."

## Open questions
- Which delta types are in-scope for v1 (all four, or start with custody + open tasks)?
- Auto-generate at shift end only, or also an on-demand "handover now" button?
