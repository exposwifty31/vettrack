# massive-01 · Passive location & custody (BLE/RFID ambient truth)

> Tier: Massive · Effort: Very High · Status: 🚧 gated · Inherits [INDEX.md](INDEX.md) conventions.
> **Standing blocker:** owner hardware appetite (capital + per-clinic install). Do not start
> code until owner says go. Strategy source: [`../session-1.md`](../session-1.md) Massive #1.

## Goal
Equipment self-reports location and custody via BLE beacons / RFID gates at doors and docks,
so "where is X / who has X" is correct **without a human scan**. Scan becomes a fallback
source, not the mechanism.

## Why 10x
The product's entire value chain — custody, readiness, analytics, damage/loss, the board — is
only as good as scan discipline, which erodes exactly under pressure (nobody scans mid-Code-Blue).
Ambient truth converts VetTrack from a "discipline-tax tool you must remember to use" into a
source of truth that is just correct. Every downstream feature improves for free. This is the
durable data moat.

## Reuse (real anchors — verify they still exist)
- `server/services/rfid-readers.service.ts` — RFID reader service scaffolding already present.
- `server/services/equipment-location-inference.ts` — existing location inference.
- `server/domain/equipment/evidence/resolver/location.ts` + `custodian.ts` — the evidence
  engine that already derives location/custodian; passive signals become a new weighted input.
- `vt_rooms.gatewayCode` (already modeled for gateways), `vt_docks`, `vt_scan_logs`.

## Approach
1. Additive `vt_location_signals` table (`clinicId`, `equipmentId`, `readerId`, `rssi`,
   `observedAt`, `source` enum `ble|rfid|scan`). Never mutate existing custody tables' semantics.
2. An ingest route for reader payloads (rate-limited; clinic-scoped auth).
3. Extend the evidence resolver to weight passive signals against last scan — **scan stays a
   first-class source**; the resolver blends, it does not replace.
4. Stage as a **single-clinic pilot** behind the existing readiness wedge
   (`docs/equipment-readiness-wedge-master-execution-plan.md`).

## New schema / surfaces
- `vt_location_signals` (+ migration). Optional `lastSeenSource` on equipment reads.
- No new user-facing surface required for v1 — it upgrades existing locate/badge/board reads.

## Frozen constraints
- Additive only; the manual scan path must be byte-for-byte unaffected for non-instrumented
  clinics (golden test is the acceptance bar).
- Partial coverage must degrade gracefully to last-known (no "unknown" regressions).
- `clinicId` on every signal read/write.

## Verification
- Simulate reader payloads → resolver returns the correct room + custodian.
- Scan-only clinic snapshot unchanged before/after (golden test).
- Ingest endpoint rejects cross-clinic reader IDs.

## Effort / Risk
Very High (hardware + firmware + resolver work). Risk: capital + install per clinic; partial
coverage gaps. Mitigate with the single-clinic pilot and graceful last-known fallback.

## Open questions
- Hardware vendor / protocol (BLE beacon vs. RFID gate vs. hybrid)?
- Pilot clinic selection and success metric (e.g. % locate queries answered without a manual scan)?
