# Asset Copilot — Implementation Plan (Draft)

**Status:** Draft v3.1 — reviewer revisions incorporated (2026-05-29)  
**Governance:** **Zero Errors, Zero Breaks** (primary constraint)  
**Reviewer verdict:** Approve M0 start; resolve §3.5–§3.8 and §6 before M0.5 shadow begins  
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

**Rollback:** **`ENABLE_ASSET_COPILOT=false`** is the primary rollback (instant, no revert). Milestone PRs may land over weeks (e.g. M1-a…M1-e); do not assume a single git revert restores safety after partial M1 merge.

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

## 3. Trust spine (implementation owned by resolver)

### 3.1 Citation contract — two layers

| Layer | What it checks | Who / what |
|-------|----------------|------------|
| **Citation validity** | Cited `type` + `id` exists in clinic; `observedAt` is real ISO time; tenant scope | `validateCopilotAnswer()` — **machine** |
| **Citation relevance** | Cited evidence **supports** the claim (semantic) | **Human review** on golden + shadow banks — **not** the validator |

- LLM **never** emits citations.
- Resolver emits `Citation { type, id, label, evidence: { observedAt } }` — **`ageMinutes` is not stored in cache** (see §3.6).
- Validator guarantees **validity only**. Production metric **`citation_relevance`** (human-rated) is separate from **`citation_validity`** (validator pass).
- **Do not claim “100% correct citation” from validator pass alone** — shadow/M0.5 gates use human relevance review (§6).

### 3.2 Confidence (two dimensions)

- `evidenceStrength`: low | medium | high (resolver rules per evidence type)
- `evidenceFreshness`: current | stale — from **`ageMinutes` computed at render/serve time** against **per-type thresholds** (§3.5), not a single global 60m

### 3.3 Unknown is success

- Explicit `unknowns[]` in `CopilotAnswer`
- Metric: `ai_answers_unknown_only` is **healthy**, not failure
- Shadow rubric: human judges “correct unknown” (§6) — not a misleading percentage on tiny n

### 3.4 Production monitoring

**Citation Coverage Dashboard** (uptime-grade):

- Fully cited / partially cited / unknown-only / validation failures
- **`citation_validity_failure`** vs **`citation_relevance_miss`** (human sample audit) — separate counters
- Page if `partially_cited / total > 2%` for 15m or validation failures spike

### 3.5 Freshness thresholds — per evidence type (M0, not deferred)

A single global “60m = current” is **incorrect** for this domain. Resolver uses **`FRESHNESS_POLICY[citation.type]`** (and optional `equipment.mobilityClass` later):

| `CitationType` | Default `current` window | Rationale |
|----------------|------------------------|-----------|
| `rfid` | 240 min (4h) | Fixed infrastructure; slow drift acceptable for “last seen” |
| `scan` | 120 min | Manual confirmation; medium decay |
| `equipment` (row / custody fields) | 60 min | Checkout/custody state changes faster |
| `transfer` | 120 min | Room/folder moves |
| `condition` | From `assetTypeConditions.staleAfterMinutes` | **Reuse existing clinical ops rule** |
| `sse` | 30 min | Event stream is high-churn |
| `waitlist` | 15 min | Queue position changes quickly |

`evidenceFreshness = ageMinutes <= policy.currentMaxMinutes ? "current" : "stale"`.

Unit tests: at least one fixture per type crossing the threshold.

### 3.6 Cache vs freshness — no frozen lies

**Problem:** Caching prose + frozen `ageMinutes` makes “4h 12m ago” wrong up to 15m later with no new events.

**Contract (M1):**

- Cache stores: `narrative`, `claims`, `citations` with **`observedAt` only** (ISO string), `resolverVersion`, `equipmentId`, `skill`.
- **Do not cache** rendered freshness strings or `ageMinutes`.
- On **serve** (cache hit or miss): recompute `ageMinutes` and `evidenceFreshness` from `observedAt` and §3.5 policies.
- Client UI may also recompute display age from `observedAt` every render (preferred for drawer open).

SSE invalidation still drops cache entries on `EQUIPMENT_*`; age drift is handled by recompute-on-serve regardless.

### 3.7 Offline and conflict coach (M1-d)

VetTrack is offline-first for **mutations**; Asset Copilot is **online-only** for all skills.

| State | Copilot UX |
|-------|------------|
| Offline | No copilot entry points enabled; no dangling “Explain conflict” on `ConflictModal`. Show i18n: requires connection (same family as emergency-block toasts). |
| `pendingSync` conflict row, still offline | User resolves via existing conflict UI only; copilot unavailable. |
| **Online after reconnect** | Conflict coach available; explains **persisted** `conflictPayload` (server vs local snapshot at capture time). |

**M1-d acceptance:** With DevTools offline, conflict modal does **not** show copilot CTA; after back online, CTA works and returns cited diff.

**Positioning:** Conflict coach is **post-reconnect / online-only**, not bedside-offline assistance.

### 3.8 Architectural enforcement — no mutation imports (M0)

**Detection-only** (“grep audit for custody changes”) is insufficient.

**G1 depcruise rule (error, M0):** modules under:

- `server/domain/equipment/evidence/**`
- `server/domain/equipment/copilot/**`
- `server/services/asset-copilot-orchestrator.service.ts`

**must not import** any path exporting equipment **write** handlers or mutation services, including but not limited to:

- `server/routes/equipment.ts` (inline checkout/return/scan/seen)
- `server/routes/equipment/handlers/post-*` mutation handlers
- `enqueueChargeAlertJob`, checkout/return service paths

Allowed: `equipment-operational-state.service.ts` (readiness **read** functions), `db` **select** via graph loader only.

Verify: `pnpm architecture:gates` fails if copilot imports a forbidden path.

---

## 4. Milestones with break-proof exit criteria

### Milestone 0 — Foundations (Weeks 1–2)

**Deliverables**

| Item | Path / artifact |
|------|-----------------|
| Shared contracts | `shared/contracts/asset-copilot.v1.ts` |
| Evidence Graph loader | `server/domain/equipment/evidence/graph.loader.ts` |
| Four resolvers | `resolver/{location,deployability,custodian,waitlist}.ts` |
| Citation validator + unit tests | `copilot/citation-validator.ts` (validity only) |
| Golden tests | `tests/asset-copilot/resolver-golden.test.ts` (30 synthetics) |
| Freshness policy | `evidence-metadata.ts` — per-type thresholds (§3.5) |
| Depcruise no-mutation rule | `scripts/architecture/` or `.dependency-cruiser.cjs` (§3.8) |
| ADR | [adr-003-asset-copilot-evidence-resolver.md](./adr-003-asset-copilot-evidence-resolver.md) |

**Exit criteria (all required)**

- [ ] `pnpm architecture:gates` pass (no new cycles + **no-mutation import rule**)
- [ ] `npx tsc --noEmit` pass (including `AuditActionType` exhaustiveness if audit kinds added early)
- [ ] `pnpm test` pass (including new golden file)
- [ ] `knip` — no orphan exports from new modules
- [ ] **M0 golden (coarse gate, n=30):** see §6.1 — not “>95%” statistical claims
- [ ] **No** HTTP routes exposed to clients yet (or routes return 404 when flag off)
- [ ] **Deployability parity:** semantic deep-equal vs `GET /equipment/:id/deployability` on **≥10 fixtures** (normalized JSON shape — **not** byte-match)
- [ ] Location / custodian / waitlist: **golden fixtures are the oracle** (no existing HTTP parity endpoint)

**Break checks**

- Resolver imports only `equipment-operational-state.service.ts` for gates — not copy-paste logic
- Graph loader: every query includes `eq(table.clinicId, clinicId)`
- Every golden miss **triaged in writing** (fixture wrong vs resolver bug) before M0 sign-off

---

### Milestone 0.5 — Shadow Mode (Weeks 3–4)

**Prerequisite:** §3.5–§3.8 and §6.2 finalized in this doc (reviewer gate before shadow starts).

**Deliverables**

- `POST /api/equipment/copilot/shadow` + orchestrator
- **Template-only path must pass shadow rubric** (§6.2) without LLM — proves resolver + validator spine
- Optional LLM narration layer after template path green (DPA not required for M0.5 if template-only passes)
- Internal reviewer UI or script: tags per §6.2
- 100-question bank: **10 categories × 10** (anti-overfit)

**Reviewers:** Named role — **Clinical ops lead or designated equipment pilot champion** + **one engineer** per shadow batch; both tag `citation_relevance` on a 10% sample minimum.

**Exit criteria**

- [ ] §6.2 shadow gate met (see statistical honesty — n=100)
- [ ] Citation validator **0** validity failures on shadow export JSON
- [ ] **Zero hallucinated facts** on shadow bank — **one fabricated fact = fail** (see §14 Q1)
- [ ] Metrics emitting (bounded enums only)
- [ ] `ENABLE_ASSET_COPILOT_SHADOW=true` staging only

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
- 15-minute answer cache (**observedAt-only** citations — §3.6); SSE invalidation
- Token cap — §8.1 (user + clinic scope)
- i18n keys in `locales/he.json` + `locales/en.json` (parity script) + **manual RTL QA** for citation chip layout (§13)

**Exit criteria**

- [ ] All M0 + M0.5 gates still pass on `main` merge
- [ ] `pnpm routes:contract` updated
- [ ] `pnpm query-keys:audit` updated
- [ ] `tests/offline-mutation-registry.test.ts` still pass — copilot not in offline registry
- [ ] Manual: Demo 1 + Demo 2 scripts on staging
- [ ] **Blocking:** Vitest render smoke — mount equipment detail (or copilot drawer), toggle drawer, assert citation region exists (non-flaky, no network)
- [ ] **Blocking:** M1-d offline UX — no copilot CTA when offline; CTA works online (§3.7)
- [ ] Hard gate: depcruise no-mutation rule still passes + **0** custody audit correlation (belt and suspenders)

**PR slicing (zero-break)**

| PR | Contents | Touches paused routes? |
|----|----------|------------------------|
| M1-a | Contracts + validator + orchestrator + routes (flag off) | No |
| M1-b | `equipment-copilot.ts` API | No |
| M1-c | `features/equipment/copilot` UI + drawer on detail + render smoke test | No |
| M1-d | Conflict modal coach (**post-reconnect only**, §3.7) | No |
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

**M3 KB safety (required before RAG ships):** see ADR-003 §RAG untrusted input — retrieved text is **data, not instruction**; KB cannot introduce citations; resolver citations remain sole source for factual equipment claims.

**Exit criteria**

- [ ] Ward display ticker **read-only** — no new polling transport (SSE/snapshot doctrine)
- [ ] Staging vs waitlist never conflated in resolver (Program Brain boundary)
- [ ] Red-team at least one poisoned KB fixture in shadow set

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

## 6. Evaluation rubric — statistical honesty

**These gates are process + human-review contracts, not precise confidence intervals.** With n=30, one miss ≈ 3.3 points — do not treat M0 percentages as statistically defensible. With n=100, expect roughly ±5–10% noise on rate targets; use **mandatory miss review** for every failure.

### 6.1 M0 golden (n ≈ 30 synthetics)

| Check | Gate | Notes |
|-------|------|-------|
| Resolver correctness | **≥90%** human-labeled correct on golden set | Every miss triaged (fixture vs code) |
| Hallucinated facts | **0** | Any claim not backed by resolver claim + valid citation = fail |
| Citation **validity** | **100%** via validator on exported answers | Machine |
| Citation **relevance** | **≥90%** on human review of all 30 | Not validator |
| Unknown handling | Manual — “correct unknown” on applicable cases | No “>95%” claim at n=30 |

**M0 does not use:** “>95% correct answer,” “<1% missing citation,” or “100% correct citation” as automated thresholds.

### 6.2 M0.5 shadow (n = 100, 10×10 categories)

| Check | Gate | Notes |
|-------|------|-------|
| Correct answer | **≥95%** human-labeled | Directional; every miss reviewed |
| Citation **relevance** | **≥98%** on full bank (human) | Separate from validity |
| Citation **validity** | **100%** validator pass | Machine |
| Correct unknown | **≥95%** where gold label = unknown | Human |
| Hallucinated facts | **0 tolerated** | **One hallucinated fact = fail the gate** (intentional strictness) |
| Unsupported recommendation | **0** | No “you should checkout/return…” |

**Template-only:** Shadow rubric must pass with **LLM disabled** (resolver templates + optional LLM polish off). If template-only cannot pass, fix resolver before enabling LLM.

**First milestone requiring LLM vendor + DPA:** **M1 production narration** (user-facing polish). M0.5 may stay template-only. Optional LLM in shadow is **nice-to-have**, not required for M0.5 exit.

**Shadow bank categories (10×10):** Deployability · RFID anomalies · Location · Missing scans · Custody · Condition state · Transfer history · Waitlist · Conflicts · General how-to

**Synthetic golden (M0):** minimum 3 per category; fixtures are oracle for location/custodian/waitlist.

---

## 7. Coordination with modularization tracks

| Modularization item | Copilot interaction |
|---------------------|---------------------|
| **Slice 4 paused mutations** | **No work** — copilot reads DB state only |
| **Slice 5 repository** | After Slice 5, migrate graph.loader to repository — **tech debt with owner** (see §7.1); not blocking M1 |
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

### 7.1 Tech debt — graph.loader vs Slice 5

Migrating `graph.loader` to an equipment repository after Slice 5 is **not optional hygiene** — it is **owned tech debt** to avoid permanent “copilot reads raw Drizzle, everything else uses repository” split. Create a tracking issue at M1 merge; target completion before M3.

---

## 8. Feature flags & environment

| Flag | Default | Purpose |
|------|---------|---------|
| `ENABLE_ASSET_COPILOT` | `false` | User-visible copilot |
| `ENABLE_ASSET_COPILOT_SHADOW` | `false` | Shadow answers + eval |
| `ASSET_COPILOT_LLM_PROVIDER` | unset | M0–M0.5 template-only sufficient |
| `ASSET_COPILOT_CACHE_TTL_MS` | `900000` | 15m (citations store `observedAt` only) |
| `ASSET_COPILOT_LLM_ENABLED` | `false` | When false, orchestrator returns template narrative only |

### 8.1 Token cap (M1)

| Dimension | Definition |
|-----------|------------|
| **Scope** | Per **`userId`** per **clinicId** (not clinic-wide aggregate) |
| **Window** | Rolling **24h UTC** for M1 (simple; not tied to `vt_shifts` until M2+ if needed) |
| **Env** | `ASSET_COPILOT_TOKEN_CAP_PER_USER_PER_DAY` (default TBD by pilot, e.g. 50k tokens) |
| **At cap** | HTTP **429** with i18n `assetCopilot.rateLimited`; client shows message |
| **Degraded mode** | Orchestrator **skips LLM** and returns **template-only** resolver narrative (still fully cited) — preferred over hard failure for explain/search |
| **Conflict coach** | Counts toward same cap; template-only still allowed at cap |

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
| Audit union omission | Add kinds in same PR as first audit log call; `tsc` catches non-exhaustive switches on `AuditActionType` |
| Hebrew parity failure | `scripts/i18n/check-parity.ts` in CI |
| RTL citation layout | Manual QA line in M1-e — chips with `·` separators in Hebrew |
| KB prompt injection (M3) | ADR-003 RAG rules + poisoned fixture in shadow |
| Cache freshness lie | §3.6 recompute on serve |

---

## 11. Decision log

| Date | Decision |
|------|----------|
| 2026-05-29 | Draft plan: Zero Errors Zero Breaks as primary gate |
| 2026-05-29 | Placement under `server/domain/equipment/` + `shared/contracts/` per modularization |
| 2026-05-29 | No paused-route extraction as dependency |
| 2026-05-29 | v3.1: rubric statistical honesty; validity vs relevance; per-type freshness; cache contract; offline UX; depcruise no-mutation; token cap defined |
| TBD | Product sign-off on M0 start |
| TBD | LLM vendor + DPA — **required before M1 user-facing LLM narration** (not M0/M0.5 if template-only passes) |

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

1. Review and approve this plan (v3.1) + ADR-003.  
2. Create tracking issue per milestone with copy-paste exit criteria checklist.  
3. Seed 30 golden JSON fixtures from staging anonymized data.  
4. Name shadow reviewers (clinical ops + engineer).  
5. Implement §3.8 depcruise rule in M0 PR1.  
6. Legal/DPA before M1 LLM narration in production (template-only may ship behind flag for pilot).

---

## 14. Sign-off questions (answered)

| Question | Answer |
|----------|--------|
| Does **0% hallucination on n=100** mean one bad answer fails? | **Yes — intentional.** One fabricated fact on the shadow bank fails M0.5. Document loudly in release checklist. |
| Who performs **citation relevance** review? | **Clinical ops lead or equipment pilot champion** + **engineer**; 100% on M0 golden (n=30), full bank on M0.5, 10% ongoing sample in production. |
| **Degraded behavior at token cap?** | **Template-only** resolver output (no LLM); 429 only if template path also exhausted (should not happen). See §8.1. |
| **First milestone requiring real LLM / DPA?** | **M1** for polished user-facing narration in production. **M0.5 must pass template-only** without LLM. |
| Is conflict coach **post-reconnect-only**? | **Yes.** Online-only; no CTA when offline; explains stored `conflictPayload` after sync failure. §3.7. |
