# medium-03 · Ambient anomaly alerting on `/board`

> Tier: Medium · Effort: Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Medium #6.

## Goal
`/board` proactively surfaces anomalies instead of passively displaying status:
*"Dock 3 empty 4h, no checkout logged," "glucometer battery critical," "waitlist backing up
20 min," "crash cart CART-2 last verified 9 days ago."*

## Why 10x
Turns a screen everyone already glances at from a mirror into an early-warning radar — value
delivered by glance, zero extra user action. Catches the silent failures that cost money
(problem #6) before they bite.

## Reuse (real anchors)
- `server/services/equipment-command-board.service.ts` — board snapshot composition.
- `server/routes/display.ts` — the `/api/display/snapshot` endpoint (⚠ cache-denylisted).
- `src/board/BoardShell.tsx` + board components; Phase-5 calm/pressure modes.
- `server/services/equipment-readiness-rules.service.ts` — readiness thresholds for anomalies.

## Approach
1. An anomaly-rules pass over the existing snapshot — a **bounded, closed set** of rule types
   (empty-dock-too-long, battery-critical, cart-unverified, waitlist-backing-up, …).
2. Render as a board section that respects calm/pressure modes (anomalies escalate in pressure).
3. No new polling — anomalies derive from the snapshot already fetched.

## New schema / surfaces
- No new tables. Anomaly derivation lives in the board service.
- A board "attention" section + optional per-role console mirror.

## Frozen constraints
- **Emergency-endpoint cache denylist:** `/api/display/snapshot` is never cached — do not add
  any caching to satisfy this feature.
- **Bounded-enum telemetry:** anomaly types must be a closed enum on both client and
  `server/routes/realtime.ts`. No free-form labels.
- No new transport.

## Verification
- Seeded anomalous state → board shows exactly the right anomaly cards; a healthy clinic shows
  none.
- Snapshot stays uncached (assert the denylist path).
- Calm vs. pressure rendering spot-check.

## Effort / Risk
Medium. Risk: rule tuning — false positives erode the glance value. Start with a few
high-precision rules, expand once trusted.

## Open questions
- Which anomaly rules ship in v1, and their thresholds (owner-configurable or fixed)?
- Do anomalies also fan out to a role's mobile home, or board-only for v1?
