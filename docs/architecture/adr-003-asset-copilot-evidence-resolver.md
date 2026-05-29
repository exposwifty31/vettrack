# ADR-003 — Asset Copilot Evidence Resolver

**Date:** 2026-05-29  
**Status:** Accepted v1.2 — pending implementation (Milestone 0)  
**Plan:** [asset-copilot-implementation-plan.md](./asset-copilot-implementation-plan.md) v3.2  
**Parent plan:** [asset-copilot-implementation-plan.md](./asset-copilot-implementation-plan.md)  
**Domain:** `equipment` ([domain-boundaries.md](./domain-boundaries.md))

---

## Context

VetTrack is adding **Asset Copilot** — an evidence-first assistant for hospital equipment operations. Product positioning: users trust **cited evidence** over informal hallway knowledge. The copilot must **never** change custody, checkout state, or offline queues.

The equipment domain already has:

- Rich schema (`server/schema/equipment.ts`)
- Operational state service (`equipment-operational-state.service.ts`) with `computeBundleReadinessGate`
- Extracted route handlers (Slice 4) and **five paused inline mutations** ([equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md))
- Frontend API extract (`src/lib/api/equipment.ts`, Slice 3)
- Types extract (`src/types/equipment.ts`, Slice 6c)

Risk: putting interpretation in LLM prompts or Express handlers recreates the pre–Slice 4 “god route” anti-pattern and breaks trust guarantees.

---

## Decision

Introduce a **three-layer read-only stack** inside the equipment domain:

1. **Evidence Graph** — loads clinic-scoped raw nodes/edges from Drizzle (no business rules).
2. **Evidence Resolver** — **single source of truth** for interpretation; emits claims, citations, unknowns, confidence.
3. **Copilot Tools / HTTP** — thin wrappers; **no** interpretation logic.

LLM orchestration (`asset-copilot-orchestrator.service.ts`) may only narrate pre-validated claims. **Citations are resolver-emitted only**; `validateCopilotAnswer()` runs before every response.

### Citation validity ≠ relevance

| | Validity | Relevance |
|---|----------|-----------|
| **Question** | Does cited ID exist with a real `observedAt`? | Does that evidence support the claim? |
| **Enforced by** | `validateCopilotAnswer()` | Human review (golden + shadow) |
| **Metric** | `citation_validity` | `citation_relevance` |

The validator must **not** be cited as proof of “100% correct citation” in exit gates.

### Module placement (modularization-aligned)

```
server/domain/equipment/evidence/     # graph + resolver
server/domain/equipment/copilot/      # validator, answer types
server/services/asset-copilot-orchestrator.service.ts
server/routes/equipment/copilot.router.ts
shared/contracts/asset-copilot.v1.ts
src/lib/api/equipment-copilot.ts
src/features/equipment/copilot/
```

Do **not** add resolver logic to:

- `server/routes/equipment.ts` inline mutations (paused)
- `src/lib/api.ts` monolith (extend `equipment-copilot.ts` only)
- LLM system prompts

### Resolver public API (M0)

```typescript
resolveCurrentLocation(ctx, equipmentId, graph?)
resolveDeployability(ctx, equipmentId, graph?)  // wraps computeBundleReadinessGate
resolveCustodian(ctx, equipmentId, graph?)
resolveWaitlistStatus(ctx, equipmentId, graph?, forUserId?)
```

M1 adds: `resolveOfflineConflict`, `searchEquipmentEvidence`.

### Freshness (M0)

Two families (plan §3.5):

1. **Observation citations** (`rfid`, `scan`, `transfer`, `sse`, `waitlist`) — time decay via `currentMaxMinutes`.
2. **State assertions** — custody/checkout on `equipment` row: **freshness stays `current`** while checked out until a superseding return/custody/transfer event. **Do not** mark custody stale based on `checkedOutAt` age alone.
3. **Condition citations** — `assetTypeConditions.staleAfterMinutes` on `verifiedAt` (existing lifecycle).

Optional UI: **Last corroborated** from latest scan/RFID consistent with custodian (observation decay applies only to that line).

**Supersession (M0 golden):** Graph loader must detect superseding events clinic-scoped (`return`, re-checkout, `transfer`, custody transitions). Fixture: checkout → later transfer → custody **not** current. Missed supersession = false “current” custody — high severity.

### Cache (M1)

Cached answers store citation `observedAt` (ISO) only; **`ageMinutes` and freshness labels are recomputed on serve** (and may be recomputed on the client each render). Never cache human-readable age strings.

### Compile-time no-mutation boundary (M0)

dependency-cruiser **error**: `server/domain/equipment/evidence/**`, `server/domain/equipment/copilot/**`, and `asset-copilot-orchestrator.service.ts` must not **transitively** depend on equipment write routes/services or barrels that re-export them. See plan §3.8.

### Deployability invariant

`resolveDeployability` **must** call existing `computeBundleReadinessGate` and `isEquipmentFullyDeployable` from `equipment-operational-state.service.ts`. HTTP `GET /api/equipment/:id/deployability` remains the behavioral reference for integration tests — compare with **semantic deep-equal** on a normalized shape, **not** byte-for-byte JSON.

Location, custodian, and waitlist resolvers have **no HTTP parity oracle**; golden fixtures are authoritative.

### Custody invariant

Resolver **must not** infer custodian from RFID alone. Checked-out custodian requires `custody_state === "checked_out"` and `checkedOutById` on `vt_equipment`.

Custodian **freshness** follows state-assertion rules (§3.5-B), not observation decay on `checkedOutAt`.

### Staging vs waitlist invariant

Resolver **must not** conflate `vt_staging_queue` (docked, next checkout) with `vt_equipment_waitlist` (device in use). Separate claims and citations per Program Brain.

### RAG / clinic KB (M3 — untrusted input)

When M3 adds pgvector retrieval over clinic-authored KB:

1. Retrieved chunks are **untrusted data**, never system instructions.
2. KB text **cannot** introduce citations; only the resolver may emit `Citation` objects for factual equipment state.
3. How-to answers may quote KB procedurally (“per clinic SOP…”) with `type: "kb"` optional metadata, but **equipment facts** (location, custody, readiness) still require resolver citations.
4. Shadow set must include at least one **poisoned KB** fixture (instruction override attempt) — answer must not obey it.
5. Prompt assembly: fixed system prompt + resolver claims JSON + KB excerpt in a clearly delimited, non-instructional block.

---

## Consequences

### Positive

- Trust spine testable without LLM (golden tests on resolver).
- Safe parallel work with modularization (no paused-route dependency).
- Clear ownership under `equipment` domain.

### Negative / cost

- New `server/domain/equipment/` tree before Slice 5 repository exists — acceptable; graph loader must migrate to equipment repository after Slice 5 (**owned tech debt**, plan §7.1).
- Additional governance: depcruise may need `server/domain/**` rules (warn → error).

### Zero-break requirements

- No changes to existing equipment mutation contracts.
- Copilot routes additive only; feature-flagged off by default.
- No new `src/` ↔ `server/` import cycles.
- Audit kinds added to closed `AuditActionType` union when logging AI events.

---

## Alternatives considered

| Alternative | Rejected because |
|-------------|------------------|
| LLM-only RAG over raw tables | Hallucination + uncitable answers violate PRD |
| Resolver in `equipment.ts` routes | Violates Slice 4 direction; couples to HTTP |
| Defer resolver until Slice 5 repository | Blocks M0 golden tests; repository is write-path optimization |
| Single `asset-copilot.service.ts` god file | Repeats appointments.service anti-pattern |

---

## Implementation order

1. `shared/contracts/asset-copilot.v1.ts`
2. Evidence Graph loader + tests (tenant isolation)
3. Resolvers (deployability first — highest volume)
4. Citation validator + golden suite
5. Shadow route + orchestrator (M0.5)
6. User-facing routes + UI (M1)

Each step: `npx tsc --noEmit`, `pnpm architecture:gates`, `pnpm test`.

---

## Verification

- [asset-copilot-implementation-plan.md](./asset-copilot-implementation-plan.md) §4–§6 exit criteria (v3.1 statistical honesty)
- M0.5 shadow 10×10 before `ENABLE_ASSET_COPILOT=true`; template-only must pass shadow without LLM
- §3.5–§3.8 complete before M0.5 shadow work starts

## Decision log

| Date | Change |
|------|--------|
| 2026-05-29 | v1.1: validity vs relevance; per-type freshness; cache contract; depcruise; RAG untrusted input; semantic parity |
| 2026-05-29 | v1.2: custody freshness = state assertion; transitive depcruise; reviewer M0 approval |
