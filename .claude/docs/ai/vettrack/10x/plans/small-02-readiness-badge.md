# small-02 · "Grab & go" readiness badge

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #2.

## Goal
One indicator per device — 🟢 ready (charged, clean, in service) / 🟡 caution / 🔴 not ready —
shown wherever a device appears (list, detail, home, board, locate results).

## Why 10x
Kills the recurring anxiety of grabbing a device and finding it dead or unusable. One glance
eliminates a whole category of failure.

## Reuse (real anchors — derivation already exists)
- `server/services/equipment-readiness-rules.service.ts` — readiness is already derived
  (config key `equipment.readinessRules.v1`, per-clinic cached).
- `server/services/equipment-operational-state.service.ts` — operational state inputs.
- **`--status-stale` tokens already in `src/index.css`** (sys-purple, light + dark, with
  `-bg/-fg/-border`) + existing status-pill components in the design system.

## Approach
1. Expose the already-derived readiness tier on equipment read responses (additive field).
2. A `<ReadinessBadge tier=...>` component composed from existing status-pill primitives + the
   existing tokens — no new palette.
3. Drop it into equipment list/detail, home surfaces, board, and locate results.

## New schema / surfaces
- None (readiness already computed). One reusable badge component.

## Frozen constraints
- Compose existing tokens; **do not introduce a new palette** (design-system rule).
- `clinicId` scoped reads. i18n the tier labels (he + en).

## Verification
- Devices with dead battery / overdue service / near expiry render the correct tier.
- RTL + dark-mode spot-check of the badge.
- Badge derivation matches the readiness-rules service (single source of truth — no duplicate
  logic in the client).

## Effort / Risk
Low. Risk: minimal. The one thing to avoid: re-deriving readiness client-side — always read the
server's derived tier.

## Open questions
- Three tiers, or a fourth "unknown/stale" state using `--status-stale` directly?
- Does the badge show the *reason* on tap (battery vs. service vs. expiry)?
