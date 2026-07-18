# small-03 · Proactive expiry / low-stock nudge to the right person

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #3.

## Goal
Surface an expiring drug / low crash-cart item / under-stocked SKU to the person who can act,
*before* it's a problem — not buried in a report.

## Why 10x
Converts existing background jobs into visible, trust-building saves. A crash cart with in-date
epinephrine is a safety win with a change in *where the signal goes* — no new detection logic.

## Reuse (real anchors — detection already runs)
- `server/workers/expiryCheckWorker.ts` + `stagingExpiryWorker.ts` — expiry detection (daily cron).
- `server/services/restock.service.ts` + `server/routes/restock.ts` — low-stock signals.
- `notification.worker` — push fan-out.
- Per-role home surfaces (`src/features/today/surfaces/*`) — the nudge target.

## Approach
1. Route the existing worker output to a **home-surface nudge** for the relevant role + an
   optional push. The detection already exists; this is delivery + routing.
2. Nudge is dismissible and links to the action (restock / replace / create PO).

## New schema / surfaces
- None required (optionally a lightweight `dismissedAt` per nudge if dedupe is needed).
- A nudge component on the role home surfaces.

## Frozen constraints
- Bounded-enum telemetry if counters are added. `clinicId` scoped. i18n the nudge copy.
- Don't add a new realtime path — reuse push + the existing home data fetch.

## Verification
- Seeded near-expiry / low-stock → nudge appears for the correct role, not others.
- Dismiss persists; no duplicate spam on refetch.
- Push fires once per event (no fan-out storms).

## Effort / Risk
Low. Risk: notification volume tuning — batch/threshold to avoid nudge fatigue.

## Open questions
- Which role owns which nudge (lead for stock, floor for cart items)?
- Lead time thresholds (e.g. expiry within 7 days, stock below reorder point)?
