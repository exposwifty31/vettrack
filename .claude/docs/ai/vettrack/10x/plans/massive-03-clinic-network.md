# massive-03 · Clinic network (equipment sharing + peer benchmarking)

> Tier: Massive · Effort: High · Status: 🚧 gated · Inherits [INDEX.md](INDEX.md) conventions.
> **Standing blocker:** buyer is single-clinic vs. multi-site (owner decision from
> [`../session-1.md`](../session-1.md)). Also requires a dedicated security design pass before
> any code. Strategy source: session-1 Massive #3.

## Goal
When a clinic is short a device, show that a partner site nearby has an idle one → request a
transfer that re-homes custody with the chain intact. Plus anonymized utilization benchmarks
("your ultrasound utilization is 34% vs. 61% peer median — you own one too many").

## Why 10x
Turns a single-clinic utility into a **network** — the first defensibility that isn't just
features (network effects + a data-product tier). Directly serves the multi-site owner (the
buyer with budget) and monetizes idle capital equipment.

## Reuse (real anchors)
- Multi-tenant `clinicId` model + `vt_clinics`.
- `server/services/equipment-custody-toggle.service.ts` — the custody state machine a transfer
  must reuse (a transfer is a custody re-home, not a new concept).
- `server/integrations/` — patterns for cross-boundary flows.

## Approach
1. A **clinic-group** concept: `vt_clinic_groups` + membership. This is the ONLY sanctioned
   cross-`clinicId` read path — every network query goes through an explicit group check.
2. A transfer request → accept flow that re-homes custody and preserves the audit chain.
3. Privacy-safe aggregate benchmarks: k-anonymity threshold (suppress below N peers), no raw
   peer rows ever returned.

## New schema / surfaces
- `vt_clinic_groups`, `vt_clinic_group_members`, `vt_equipment_transfers`.
- A network panel in the web console (transfers + benchmarks); mobile request/accept.
- New `AuditActionType`s for transfer request/accept/reject.

## Frozen constraints (⚠ security-critical)
- Cross-tenant is the highest-risk surface in the product — the `clinicId`-per-query rule
  becomes load-bearing. **No network read may bypass the group-membership check.**
- Benchmarks must be genuinely anonymized (k-anonymity enforced server-side).
- Requires a security design pass + `security-reviewer` before merge.

## Verification
- **Negative test is the acceptance bar:** a clinic not in a group can never read another
  clinic's rows via any network endpoint.
- Transfer re-homes custody and leaves a complete audit trail on both sides.
- Benchmark suppresses cohorts below the k threshold.

## Effort / Risk
High. Risk: data-isolation boundary correctness; anonymization correctness. Gate behind proven
single-clinic value.

## Open questions
- Group formation: owner-defined static groups, or opt-in marketplace?
- Transfer logistics — does VetTrack track physical hand-off, or just custody re-home?
