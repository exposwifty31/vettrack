# massive-02 · Predictive readiness engine ("will you be ready")

> Tier: Massive · Effort: High · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Massive #2.

## Goal
A forward-looking engine that turns scheduled demand + inventory + roster + expiry + usage
history into conservative, explainable warnings:
*"Tomorrow's 3 surgeries need 2 anesthesia machines; you have 1 functioning + 1 overdue for
service. Crash-cart epinephrine expires Thursday. You'll be short 4 IV sets by 14:00 at current
burn."*

## Why 10x
Every current surface answers "what is true now." Nobody answers "will I be ready." That is the
question that actually loses money and endangers patients (problems #5/#6 in `program-plan.md`
I.3). It reframes VetTrack from a ledger into an advisor — and creates the owner-facing "money
saved" narrative.

## Reuse (real anchors)
- `server/services/operational-metrics.service.ts` — existing metrics aggregation.
- `server/services/restock.service.ts` + `server/routes/restock.ts` + PO flow — supply + reorder.
- `server/workers/expiryCheckWorker.ts` + `stagingExpiryWorker.ts` — expiry signals.
- `server/routes/analytics.ts` — extend the existing Analytics console (Phase 7), don't add a
  new surface family.
- `vt_appointments` (unified task/schedule model) — scheduled procedures → demand.

## Approach
1. New `server/services/readiness-forecast.service.ts` with an internal sub-phase split:
   **demand model** (schedule → required equipment/consumables) →
   **supply model** (available + *ready* units, current stock) →
   **shortfall join** (demand − supply, plus burn-rate projection) →
   **surface**.
2. Render as an Analytics console panel + pre-filled PO recommendations that flow into the
   existing `restock`/PO path.
3. **Explainable:** every warning shows the source rows behind it (which appointment, which
   stock level, which burn rate). Conservative thresholds — under-warn rather than cry wolf.

## New schema / surfaces
- No new tables required for v1 (read-mostly over existing data). Optional: a small
  `equipment.requires[]` / procedure-template mapping to model demand cleanly — decide during
  the demand-model sub-phase.
- One new Analytics console panel; optional home-surface summary tile.

## Frozen constraints
- Read-mostly; no new transport. Bounded-enum telemetry if counters are added.
- `clinicId` on every read.

## Verification
- Seeded schedule + stock → engine emits exactly the expected shortfalls.
- Explainability panel lists the source rows for each warning.
- A "no shortfall" clinic shows a calm, empty state (no false alarms).

## Effort / Risk
High (mostly software; data mostly exists). Risk: **trust** — noisy or aggressive predictions
get ignored, same failure mode as a noisy alert. Bias toward precision over recall in v1.

## Open questions
- How is per-procedure equipment/consumable demand modeled — explicit templates, or inferred
  from historical usage per appointment type?
- Burn-rate window (trailing 7/14/30 days)?
