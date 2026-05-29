# Asset Copilot — Implementation Plan (Draft)

**Status:** Draft — engineering + product sign-off required before M0 coding  
**Governance:** **Zero Errors, Zero Breaks** (primary constraint)  
**Product line:** Asset Copilot succeeds when users trust its evidence more than they trust hallway conversations.  
**Positioning:** **Evidence Copilot** — explains state, never changes it.  
**Modularization alignment:** [modularization-plan.md](./modularization-plan.md) · [modularization-status.md](./modularization-status.md) · [domain-boundaries.md](./domain-boundaries.md)  
**Architecture spine:** Evidence Graph → **Evidence Resolver** (interpretation SSOT) → read-only Copilot Tools → UI (citations + strength + freshness)

---

## 1. Zero Errors, Zero Breaks — governing doctrine

Every milestone ships only when **all** gates below pass. A single failed gate blocks merge—not “fix in follow-up.”

| Principle | Meaning in VetTrack |
|-----------|---------------------|
| **Zero type errors** | `npx tsc --noEmit` clean on every PR; no `@ts-expect-error` without ADR note |
| **Zero contract drift** | No URL/method/body changes to existing equipment APIs; new routes only under additive paths |
| **Zero query-key regressions** | New keys registered; existing `["/api/equipment", …]`, `["deployability", id]` invalidation unchanged |
| **Zero new import cycles** | `pnpm architecture:gates` — server cycle count must not exceed baseline (4); `src/` stays at 0 |
| **Zero offline/realtime breaks** | Copilot is **online-only**; does not alter `pendingSync`, replay middleware, or SSE contracts |
| **Zero custody mutations via AI** | No tool or agent path calls checkout/return/patch/scan/seen |
| **Zero pilot regressions** | `PILOT_MODE` equipment surfaces keep working; copilot behind `ENABLE_ASSET_COPILOT` (default off) |
| **Zero citation integrity failures** | Server-side `validateCopilotAnswer` — failed validation returns safe unknown-only response |

**Rollback:** one milestone ≈ one revertable commit series; feature flag disables all user-visible copilot without removing code.

**Explicit non-goals (break prevention):**

- Do **not** extract [paused equipment mutations](./equipment-inline-mutations-inventory.md) as part of copilot work
- Do **not** start [Slice 5](./modularization-plan.md) repository refactor in the same PR as copilot M1 UI
- Do **not** rename frozen surfaces (`EQUIPMENT_*` outbox types, queue names, `appointmentsPage.*`)
- Do **not** add WebSockets, second realtime transport, or emergency-endpoint caching for copilot

---

## 2. Modular placement (aligned with refactor)

### 2.1 Domain ownership

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Evidence Graph** | `server/domain/equipment/evidence/graph.loader.ts` | Clinic-scoped read queries only; no interpretation |
| **Evidence Resolver** | `server/domain/equipment/evidence/resolver/*.ts` | `resolveCurrentLocation`, `resolveDeployability`, `resolveCustodian`, `resolveWaitlistStatus`, `resolveOfflineConflict` |
| **Resolver deps** | Reuse `computeBundleReadinessGate`, `isEquipmentFullyDeployable` from `server/services/equipment-operational-state.service.ts` | **Do not duplicate** readiness math |
| **Citation validator** | `server/domain/equipment/copilot/citation-validator.ts` | Machine-enforce citation contract |
| **Orchestrator** | `server/services/asset-copilot-orchestrator.service.ts` | LLM prose only; merges resolver output |
| **HTTP** | `server/routes/equipment/copilot.router.ts` mounted from `server/routes/equipment.ts` | Thin handlers; `requireAuth`; rate limit |
| **Shared contracts** | `shared/contracts/asset-copilot.v1.ts` | `Citation`, `CopilotAnswer`, `Confidence` — safe for client + server |
| **Frontend API** | `src/lib/api/equipment-copilot.ts` re-exported via `src/lib/api/equipment.ts` | Same pattern as Slice 3 |
| **Frontend UI** | `src/features/equipment/copilot/*` | Drawer, conflict coach hook; **not** bloating `equipment-detail.tsx` in one PR |
| **Types** | Extend `src/types/equipment.ts` only if client-specific; prefer `shared/contracts` for wire types |

**Target layout (incremental — no big-bang move):**

```
server/domain/equipment/
  evidence/
    graph.types.ts
    graph.loader.ts
    resolver/
      location.ts
      deployability.ts
      custodian.ts
      waitlist.ts
      conflict.ts
      index.ts
  copilot/
    citation-validator.ts
    answer.types.ts
server/services/
  asset-copilot-orchestrator.service.ts
server/routes/equipment/
  copilot.router.ts          # POST .../copilot/explain|search|conflict|shadow
shared/contracts/
  asset-copilot.v1.ts
src/features/equipment/
  copilot/
    CopilotDrawer.tsx
    CopilotCitationChip.tsx
    useEquipmentCopilot.ts
    query-keys.ts
src/lib/api/
  equipment-copilot.ts
```

**Why `server/domain/equipment/`:** Matches [domain-boundaries.md](./domain-boundaries.md) target layout without waiting for Slice 5 repository. Graph/resolver are **read-only** and do not require paused-route extraction.

### 2.2 Route registration (Slice 7–safe)

Add routes **under existing equipment mount** (no new top-level router):

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/equipment/copilot/explain` | `{ equipmentId }` |
| `POST` | `/api/equipment/copilot/search` | `{ query, limit? }` |
| `POST` | `/api/equipment/copilot/conflict` | `{ pendingSyncId?, conflictPayload }` — server validates clinic + user |
| `POST` | `/api/equipment/copilot/shadow` | M0.5 only; `ENABLE_ASSET_COPILOT_SHADOW` |

After merge: `pnpm routes:contract -- --write-contract` (intentional contract update).

### 2.3 Frontend modularization sequence

| Step | Slice alignment | Risk |
|------|-----------------|------|
| Add `equipment-copilot.ts` API + shared types | Slice 3 extension | Low |
| Add `features/equipment/copilot/` components | Slice 8+ feature extraction | Low |
| Wire drawer into `equipment-detail.tsx` | Page still large — **UI-only diff** | Medium — manual QA |
| Conflict coach in `ConflictModal` | Offline domain | Medium — `pnpm test` offline suite |
| Register query keys in `src/features/equipment/copilot/query-keys.ts` + registry | G4 | Low |

**Query keys (new — register before merge):**

```ts
["/api/equipment/copilot/explain", equipmentId]
["/api/equipment/copilot/search", query]
["/api/equipment/copilot/conflict", pendingSyncId]
```

**Cache invalidation:** extend `src/lib/equipment-realtime.ts` / `invalidateEquipmentCaches()` — copilot keys invalidated on `EQUIPMENT_*` SSE (same as deployability). **Do not** invalidate on keepalive.

### 2.4 Types (Slice 6–safe)

- Wire types live in `shared/contracts/asset-copilot.v1.ts`
- Optional re-export from `src/types/equipment.ts` for convenience
- **6j follow-up:** point `equipment-copilot.ts` at `@/types/equipment` only for UI-local types
- **No** changes to `ScanLog`, `Equipment`, or offline-db shapes in M0–M1

---

## 3. Trust spine (unchanged from v3 — implementation owned by resolver)

### 3.1 Citation contract

- LLM **never** emits citations
- Resolver emits `Citation { type, id, label, evidence: { observedAt, ageMinutes } }`
- `validateCopilotAnswer()` before any response leaves server

### 3.2 Confidence (two dimensions)

- `evidenceStrength`: low | medium | high
- `evidenceFreshness`: current | stale (from `ageMinutes`; default threshold 60m current)

### 3.3 Unknown is success

- Explicit `unknowns[]` in `CopilotAnswer`
- Metric: `ai_answers_unknown_only` is **healthy**, not failure
- Rubric: **>95% correct unknown** on shadow set

### 3.4 Production monitoring

**Citation Coverage Dashboard** (uptime-grade):

- Fully cited / partially cited / unknown-only / validation failures
- Page if `partially_cited / total > 2%` for 15m or validation failures spike

---

## 4. Milestones with break-proof exit criteria

### Milestone 0 — Foundations (Weeks 1–2)

**Deliverables**

| Item | Path / artifact |
|------|-----------------|
| Shared contracts | `shared/contracts/asset-copilot.v1.ts` |
| Evidence Graph loader | `server/domain/equipment/evidence/graph.loader.ts` |
| Four resolvers | `resolver/{location,deployability,custodian,waitlist}.ts` |
| Citation validator + unit tests | `copilot/citation-validator.ts` |
| Golden tests | `tests/asset-copilot/resolver-golden.test.ts` (30 synthetics) |
| ADR | [adr-003-asset-copilot-evidence-resolver.md](./adr-003-asset-copilot-evidence-resolver.md) |

**Exit criteria (all required)**

- [ ] `pnpm architecture:gates` pass (no new cycles)
- [ ] `npx tsc --noEmit` pass
- [ ] `pnpm test` pass (including new golden file)
- [ ] `knip` — no orphan exports from new modules
- [ ] Resolver golden rubric **≥90%** on 30 synthetics (see §6)
- [ ] **No** HTTP routes exposed to clients yet (or routes return 404 when flag off)
- [ ] Deployability resolver byte-matches `GET /equipment/:id/deployability` for 10 fixture equipments (integration test with Postgres optional)

**Break checks**

- Resolver imports only `equipment-operational-state.service.ts` for gates — not copy-paste logic
- Graph loader: every query includes `eq(table.clinicId, clinicId)`

---

### Milestone 0.5 — Shadow Mode (Weeks 3–4)

**Deliverables**

- `POST /api/equipment/copilot/shadow` + orchestrator (LLM optional — template-only path allowed)
- Internal reviewer UI or script: tag `correct | partial | incorrect`
- 100-question bank: **10 categories × 10** (anti-overfit)

**Exit criteria**

- [ ] Rubric **>95%** correct answer, **100%** correct citation, **>95%** correct unknown, **0%** hallucinated data on shadow bank
- [ ] Citation validator **0** failures on shadow export JSON
- [ ] Metrics emitting to existing metrics pipeline (bounded enums only)
- [ ] Feature flag: `ENABLE_ASSET_COPILOT_SHADOW=true` staging only

**Break checks**

- Shadow endpoint rate-limited; not mounted in production until M1
- No writes to `vt_equipment`, `pendingSync`, or outbox from shadow pipeline

---

### Milestone 1 — Asset Copilot Lite (Weeks 5–9)

**Skills:** Explain state · Find asset · Explain conflict

**Deliverables**

- User-facing drawer + suggested questions
- `ENABLE_ASSET_COPILOT` (default `false`)
- Audit kinds added to closed union: `ai_equipment_query`, `ai_equipment_explain`, `ai_equipment_suggestion_accepted`
- 15-minute answer cache; SSE invalidation
- Per-shift token cap (clinic + user)
- i18n keys in `locales/he.json` + `locales/en.json` (parity script)

**Exit criteria**

- [ ] All M0 + M0.5 gates still pass on `main` merge
- [ ] `pnpm routes:contract` updated
- [ ] `pnpm query-keys:audit` updated
- [ ] `tests/offline-mutation-registry.test.ts` still pass — copilot not in offline registry
- [ ] Manual: Demo 1 + Demo 2 scripts on staging
- [ ] Playwright smoke (optional): open drawer, see citations — **not** blocking M1 if flaky; unit tests blocking
- [ ] Hard gate: **0** custody changes attributed to copilot in audit log (grep `ai_equipment` + verify no checkout/return audit correlation)

**PR slicing (zero-break)**

| PR | Contents | Touches paused routes? |
|----|----------|------------------------|
| M1-a | Contracts + validator + orchestrator + routes (flag off) | No |
| M1-b | `equipment-copilot.ts` API | No |
| M1-c | `features/equipment/copilot` UI + drawer on detail | No |
| M1-d | Conflict modal coach | No — reads `conflictPayload` only |
| M1-e | i18n + audit kinds + metrics + flags | No |

---

### Milestone 2 — Accountability Coach (Weeks 10–14)

**Deliverables:** My Equipment coach · end-of-shift digest (BullMQ `ai_equipment_digest` — **new worker** registered in `start-schedulers.ts`) · charge-alert inline nudge · stale prioritizer

**Exit criteria**

- [ ] Digest job idempotent (`clinicId` + date + shift bucket)
- [ ] Digest **never** calls return/checkout
- [ ] `pnpm test` + integration test for job enqueue when Redis available (skip if no Redis — match existing worker tests)
- [ ] No regression to `chargeAlertWorker` job IDs (`plug-check-${returnId}`)

---

### Milestone 3 — Radar, Waitlist & Knowledge (Weeks 15–21)

**Deliverables:** Waitlist companion · room radar diff · ward display read-only ticker · how-to RAG (clinic KB); pgvector internal only

**Exit criteria**

- [ ] Ward display ticker **read-only** — no new polling transport (SSE/snapshot doctrine)
- [ ] Staging vs waitlist never conflated in resolver (Program Brain boundary)

---

### Milestone 4 — Admin & Analytics (Weeks 22–27)

**Deliverables:** Billing explainer (ledger + rule + narrative) · CSV import fixer · RFID reconciler (**triage only**) · utilization narrative

**Exit criteria**

- [ ] Billing explainer cites ledger row IDs — no new billing writes
- [ ] RFID reconciler does not PATCH equipment

---

## 5. Verification matrix (every PR)

```bash
npx tsc --noEmit
pnpm architecture:gates
pnpm test
pnpm query-keys:audit          # if touching query keys / realtime invalidation
pnpm routes:contract           # if touching routes (warn-only ok until --write-contract)
knip                           # after adding/removing exports
```

**When touching equipment reads only:**

```bash
pnpm test -- tests/equipment-pilot-verification.test.ts   # if deployability-related
```

**When touching offline conflict UI:**

```bash
pnpm test -- tests/offline-mutation-registry.test.ts tests/conflict*.test.ts  # if present
```

**Optional Postgres integration (resolver):**

```bash
pnpm test:integration:ops    # only if graph loader integration tests added
```

---

## 6. Evaluation rubric (launch gate)

| Metric | Target |
|--------|--------|
| Correct answer | >95% |
| Correct citation | 100% |
| Correct unknown responses | >95% |
| Hallucinated data | 0% |
| Unsupported recommendation | 0% |
| Missing citation | <1% |
| User-rated helpful (post-pilot) | >80% |

**Shadow bank categories (10×10):** Deployability · RFID anomalies · Location · Missing scans · Custody · Condition state · Transfer history · Waitlist · Conflicts · General how-to

**Synthetic golden (30):** minimum 3 per category for M0.

---

## 7. Coordination with modularization tracks

| Modularization item | Copilot interaction |
|---------------------|---------------------|
| **Slice 4 paused mutations** | **No work** — copilot reads DB state only |
| **Slice 5 repository** | After Slice 5, migrate graph.loader to repository — **optional**; not blocking M1 |
| **Slice 6j** | Migrate copilot API imports to `@/types/equipment` when convenient |
| **Slice 7** | Register copilot router in grouped `routes.ts` section |
| **Slice 8+ api.ts** | `equipment-copilot.ts` already extracted — do not re-inline into `api.ts` |
| **G1–G5 governance** | New `server/domain/` paths — add depcruise rule as **warn** first, then error |

**Recommended parallel schedule (no cross-block):**

```
Weeks 1–4:  M0 + M0.5 (copilot)  ||  Slice 7 (route grouping) + Slice 6j (types import)
Weeks 5–9:  M1 (copilot UI)       ||  Slice 8+ next api domain extract (non-equipment)
Weeks 10+:  M2+                   ||  Slice 2 / Slice 5 only with separate owners
```

---

## 8. Feature flags & environment

| Flag | Default | Purpose |
|------|---------|---------|
| `ENABLE_ASSET_COPILOT` | `false` | User-visible copilot |
| `ENABLE_ASSET_COPILOT_SHADOW` | `false` | Shadow answers + eval |
| `ASSET_COPILOT_LLM_PROVIDER` | unset | M0 can be template-only |
| `ASSET_COPILOT_CACHE_TTL_MS` | `900000` | 15m |
| `ASSET_COPILOT_TOKEN_CAP_PER_SHIFT` | clinic-configurable | Cost guard |

Pilot hosts: enable only after M0.5 rubric green on staging.

---

## 9. Demos (sales — unchanged)

**Demo 1 — Explanation:** “Why not ready?” on shared ventilator → cited condition + next step.

**Demo 2 — Trust:**

```
User:    Where is Pump 217?
Copilot: Last seen: Room 4 · Strength: High · Freshness: Stale · Evidence: RFID #84211 · 4h ago

User:    Who has it now?
Copilot: Unknown. No custody transfer or scan evidence available.
```

---

## 10. Risk register (zero-break focus)

| Risk | Mitigation |
|------|------------|
| Resolver drift from deployability API | Shared `computeBundleReadinessGate`; contract test |
| New import cycle via `api.ts` | Copilot API in `equipment-copilot.ts`; madge gate |
| Copilot blocks scan/checkout UX | Drawer overlay only; never modal-block scanner |
| LLM cites fake IDs | Validator rejects; safe fallback |
| Offline users hit copilot | API returns 503 + i18n “requires connection”; no cache pretend-live |
| Large equipment.ts conflict | Copilot in `copilot.router.ts` sub-router |
| Audit union omission | Add kinds in same PR as first audit log call |
| Hebrew parity failure | `scripts/i18n/check-parity.ts` in CI |

---

## 11. Decision log

| Date | Decision |
|------|----------|
| 2026-05-29 | Draft plan: Zero Errors Zero Breaks as primary gate |
| 2026-05-29 | Placement under `server/domain/equipment/` + `shared/contracts/` per modularization |
| 2026-05-29 | No paused-route extraction as dependency |
| TBD | Product sign-off on M0 start |
| TBD | LLM vendor + DPA for production |

---

## 12. Related documents

| Document | Use |
|----------|-----|
| [modularization-status.md](./modularization-status.md) | Done vs left for refactor |
| [equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md) | Paused writes — do not touch |
| [offline-realtime-invariants.md](./offline-realtime-invariants.md) | Frozen transport |
| [adr-003-asset-copilot-evidence-resolver.md](./adr-003-asset-copilot-evidence-resolver.md) | Resolver ADR (companion) |
| Asset Copilot PRD v3 | Product requirements (internal) |

---

## 13. Immediate next steps (pre-code)

1. Review and approve this plan + ADR-003.  
2. Create tracking issue per milestone with copy-paste exit criteria checklist.  
3. Seed 30 golden JSON fixtures from staging anonymized data.  
4. Confirm LLM approach for M0.5 (template-only vs API).  
5. Legal/DPA checkpoint before `ENABLE_ASSET_COPILOT=true` in production.
