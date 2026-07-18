# small-05 · Per-role "start of shift" summary card

> Tier: Small · Effort: Low–Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #5. Fits anywhere; cheap.

## Goal
The first thing each role sees at shift start — floor: "your assigned gear, open tasks, any
active Code Blue"; lead: "coverage gaps, low stock, overdue services."

## Why 10x
Creates a daily open-VetTrack-first habit (retention) and orients staff in one glance. Reuses
the per-role home split already shipped — pure composition.

## Reuse (real anchors — surfaces already exist)
- `src/features/today/surfaces/{Floor,Vet,Tech,Student,Ops}HomeSurface.tsx` — per-role homes.
- `src/features/today/surfaces/OnShiftHero.tsx` — roster-derived on-shift state (already built).
- Experience-model archetypes + capability union (per-role gating already exists).
- Pairs with small-01 (locate), small-02 (badge), small-03 (nudges) as card contents.

## Approach
1. Compose existing per-role data into one summary card per home surface — no new data sources,
   just a curated first-glance arrangement keyed off the on-shift hero.
2. Gate card contents by the existing capability union (floor vs. ops composition differs).

## New schema / surfaces
- None. One summary-card component parameterized per archetype.

## Frozen constraints
- Per-role gating via the **existing** capability union — no new nav entries, no new roles.
- i18n all copy (he + en). Respect the roster-derived shift model (no clock-in invented).

## Verification
- Each role's card shows the correct composition (floor ≠ lead ≠ student).
- Off-shift state renders a sensible empty/idle variant.
- RTL spot-check across the role surfaces.

## Effort / Risk
Low–Medium. Risk: low. Main design choice is *what* each role sees first — keep it to 3–4 items
to preserve the one-glance value.

## Open questions
- Exact per-role contents (owner input, or infer from each surface's current top items)?
- Does the card collapse after first interaction, or persist for the shift?
