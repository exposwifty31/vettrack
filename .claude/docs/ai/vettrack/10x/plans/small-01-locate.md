# small-01 · Universal "Where is it?" locate

> Tier: Small · Effort: Low · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Small Gem #1. **Recommended first execute.**

## Goal
A prominent, always-reachable search that answers *"where is the [device]"* instantly —
last-known location + who has it + ready/not.

## Why 10x
The #1 daily micro-frustration in a clinic (minutes lost, many times a day). Even on manual-scan
data it beats walking the halls; on passive data (massive-01) it becomes magic. Near-zero new
data — fastest real-user win in the whole library.

## Reuse (real anchors — the engine already exists)
- `server/domain/equipment/evidence/resolver/location.ts` + `custodian.ts` — already derive a
  device's location + custodian.
- `server/services/equipment-location-inference.ts`.
- `src/lib/api.ts` (add one typed fn) + `src/types/`.
- Existing equipment UI to link into: `src/pages/equipment-detail.tsx`, `src/features/equipment/*`.

## Approach
1. A read-only `GET /api/equipment/locate?q=` endpoint that composes the existing resolvers and
   returns `{ location, custodian, readiness }` per match. No new derivation logic.
2. A prominent search entry: mobile home (pairs with small-05) + web console top bar.
3. Result row links straight to equipment detail.

## New schema / surfaces
- None (read-only over existing data). One search component reused on mobile + console.

## Frozen constraints
- Standard checklist; `clinicId` scoped. Rate-limit under the scan/action limiter family.

## Verification
- Query returns the correct room + custodian + readiness for seeded devices.
- Empty/no-match and loading states render (RTL spot-check).
- Cross-clinic device is never returned.

## Effort / Risk
Low. Risk: minimal (read-only). If reused with small-02, surface the readiness badge inline.

## Open questions
- Search scope — name + asset tag only, or also type/room?
- Placement on the web console: command-bar (Cmd+K) or a persistent search field?
