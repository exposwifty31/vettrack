# small-04 · One-tap "returned damaged" at check-in

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #4.

## Goal
On check-in, a single "damaged / needs service" tap that flags the device and starts a damage
trail.

## Why 10x
Tiny UI, but it's the **seed data** for the entire damage/loss money story (problem #6 /
roadmap #6) and feeds the predictive engine (massive-02). Without a frictionless capture point,
the analytics have nothing to analyze.

## Reuse (real anchors)
- Custody return flow: `server/services/equipment-custody-toggle.service.ts`,
  `server/routes/equipment.ts` (return/check-in path).
- `server/services/equipment-operational-state.service.ts` — flip the device to a
  needs-service/out-of-service state.
- Return UI in `src/features/equipment/*` — add the one tap there.

## Approach
1. Add a "returned damaged" affordance on the existing check-in/return control.
2. Write a damage event + set the device condition; optionally open a service task.

## New schema / surfaces (required — nothing exists today)
- `vt_damage_events` (`clinicId`, `equipmentId`, `reportedBy`, `at`, `note`, `resolvedAt`).
- Optional `conditionStatus` column on equipment (`ok | damaged | out_of_service`).
- New `AuditActionType` for damage-report.

## Frozen constraints
- Standard feature checklist (schema → migration → route → api → i18n → audit → tsc).
- `clinicId` scoped. A damaged device must reflect in readiness (small-02) as not-ready.

## Verification
- Check-in with "damaged" writes a `vt_damage_events` row + flips condition.
- The device then reads as not-ready (readiness rules pick up condition).
- Analytics/predictive can query damage events by clinic + period.

## Effort / Risk
Low. Risk: low. Keep the capture to one tap + optional note — don't build a full RMA workflow.

## Open questions
- Does "damaged" auto-create a service task, or just flag + note for v1?
- Required note, or optional?
