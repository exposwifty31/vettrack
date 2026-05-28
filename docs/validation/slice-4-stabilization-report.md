# Slice 4 stabilization report (Option A)

**Date:** 2026-05-28  
**Branch:** `main`  
**Commit:** `b91aa6f1c42978b445559fe3634ac8d658f51374`  
**Scope:** Verification and documentation only — **no** refactors, handler extraction, repository layer, or paused-route work.

---

## Executive summary

| Question | Answer |
|----------|--------|
| **Slice 4 complete (safe routes)?** | **Yes** — all planned non-paused equipment handlers are extracted; middleware remains on `equipment.ts`. |
| **Regressions observed in verification?** | **None observed** in architecture gates, TypeScript, route/query contracts, or targeted equipment/replay/offline/pilot tests on this commit. |
| **Safe to proceed to Slice 6?** | **Yes** — for the **frontend types split** defined in [modularization-plan.md](../architecture/modularization-plan.md) (Slice 6: `src/types/index.ts` by domain). This is independent of paused equipment mutations. **Do not** start Slice 5 (equipment repository) or paused-route extraction under the Slice 4 banner. |

---

## Slice 4 final state

### Scale

| Metric | Value |
|--------|--------|
| `server/routes/equipment.ts` | **~1,386 lines** (down from ~2,143 pre–Slice 4) |
| Handler modules under `server/routes/equipment/handlers/` | **17** |
| Supporting module | `server/routes/equipment/equipment-import-csv.ts` (import CSV helpers only) |
| Inline mutations remaining | **5** (all **paused** — see below) |

### Extracted surfaces (verified wired on `main`)

| Category | Routes / methods | Handler module(s) |
|----------|------------------|-------------------|
| **Reads** | `GET /`, `/my`, `/deleted`, `/critical`, `/pilot-coverage`, `/:id`, `/:id/logs`, `/:id/transfers` | `get-equipment-*.ts` (8 handlers) |
| **Lifecycle** | `POST /:id/restore`, `DELETE /:id`, `POST /:id/revert` | `post-equipment-restore.ts`, `delete-equipment.ts`, `post-equipment-revert.ts` |
| **Bulk admin** | `POST /bulk-verify-room`, `/import`, `/bulk-move`, `/bulk-delete` | `post-equipment-bulk-verify-room.ts`, `post-equipment-import.ts` (+ csv), `post-equipment-bulk-move.ts`, `post-equipment-bulk-delete.ts` |
| **CRUD (replay + offline)** | `POST /` (create), `PATCH /:id` (update) | `post-equipment-create.ts`, `patch-equipment.ts` |

### Router invariants (unchanged by design)

- **Middleware** for every extracted route remains registered on `router.*` in `equipment.ts`.
- **Replay idempotency** on router for create / update / delete:
  - `equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.create)` before `postEquipmentCreateHandler`
  - `equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.update)` before `patchEquipmentHandler`
  - `equipmentReplayIdempotency(EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.delete)` before `deleteEquipmentHandler`
- **Import:** `upload.single("file")` remains on the router for `POST /import`.
- **Paths:** no route path changes; `pnpm routes:contract` holds **320 / 320**.

---

## Paused routes (explicitly out of scope)

**Do not extract** without dedicated product/engineering approval and expanded integration coverage:

| Method | Path | Why paused |
|--------|------|------------|
| `POST` | `/scan` | Quick-scan; no replay registry entry; overlaps checkout/return semantics |
| `POST` | `/:id/checkout` | Waitlist, staging, V1 gates, outbox, offline checkout |
| `POST` | `/:id/return` | Waitlist, charge-alert worker, returns, offline `return_with_charge` |
| `POST` | `/:id/seen` | Billing via `recordEquipmentSeen` service |
| `POST` | `/:id/scan` | Replay + offline scan + undo tokens + push |

Canonical inventory: [equipment-inline-mutations-inventory.md](../architecture/equipment-inline-mutations-inventory.md).

Replay middleware for **checkout, return, seen, scan** remains on inline routes in `equipment.ts` — intentional; not part of Slice 4 completion criteria.

---

## Verification matrix (2026-05-28)

Commands run on commit `b91aa6f1` unless noted.

| Area | Check | Result |
|------|--------|--------|
| **Architecture** | `pnpm architecture:gates` | **Pass** (G1: tsc server/frontend, dependency-cruiser, madge cycle baseline) |
| **Types** | `npx tsc --noEmit` | **Pass** (zero errors) |
| **Routes** | `pnpm routes:contract` | **Pass** — extracted **320**, contract **320** |
| **Query keys** | `pnpm query-keys:audit` | **Pass** — discovered **109**, registry **109** |
| **Equipment reads** | Handlers imported; `GET /`, `/:id`, `/my`, `/deleted`, `/critical`, logs, transfers on router | **OK** |
| **Lifecycle** | restore / delete / revert handlers wired | **OK** |
| **Bulk** | bulk-verify-room, import, bulk-move, bulk-delete handlers wired | **OK** |
| **Create / update** | Handlers wired; replay middleware on router | **OK** |
| **Offline list/detail** | `src/lib/api/equipment.ts` — `isNetworkError` → Dexie cache for list, filtered list, my, getById | **OK** (static paths in module) |
| **Offline create/update** | `offlineType: "create"` on `POST /api/equipment`; `offlineType: "update"` on `PATCH /api/equipment/:id` | **OK** — `offline-mutation-registry.test.ts` |
| **Offline delete** | `offlineType: "delete"` on `DELETE /api/equipment/:id` | **OK** (registry) |
| **Replay registry** | `EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS` create / update / delete | **OK** — `equipment-replay-idempotency.routes.test.ts` asserts router wiring |
| **Pilot bulk-verify** | Assertions target `post-equipment-bulk-verify-room.ts` | **OK** — `equipment-pilot-verification.test.ts` |

### Targeted test run

```bash
pnpm exec vitest run \
  tests/phase-5-route-error-contract.test.js \
  tests/equipment-scan-lifecycle.test.ts \
  tests/equipment-replay-idempotency.routes.test.ts \
  tests/equipment-replay-idempotency.lib.test.ts \
  tests/offline-mutation-registry.test.ts \
  tests/equipment-pilot-verification.test.ts
```

| Result | Count |
|--------|-------|
| **Pass** | **6 files / 107 tests** |

**Regressions:** none observed in this suite on the stabilization commit.

**Not run for this report (out of Option A scope):** full `pnpm test`, Playwright Phase 9 drills, DB-backed integration tests (`equipment-replay-idempotency.integration.test.ts`, `equipment-version-occ.integration.test.ts`), live-server worker tests.

---

## Slice 4 merge history (reference)

| Slice | PR | Route |
|-------|-----|-------|
| 4a–4c | #530–#532 | GET reads |
| 4d | #534 | `POST /:id/restore` |
| 4e | #536 | `DELETE /:id` |
| 4f-1 | #539 | `POST /:id/revert` |
| 4g | #541 | `POST /bulk-verify-room` |
| 4h | #542 | `POST /import` |
| 4i | #543 | `POST /bulk-move` |
| 4j | #548 | `POST /bulk-delete` |
| 4k | #549 | `POST /` (create) |
| 4l | #550 | `PATCH /:id` |
| Docs | #538, #547, #551 | Inventory + stabilization docs |

---

## Recommendation: proceed to Slice 6?

**Yes**, with clear boundaries:

| Proceed | Do not conflate |
|---------|------------------|
| **Slice 6** — split `src/types/index.ts` by domain + barrel ([modularization-plan.md](../architecture/modularization-plan.md)) | **Slice 5** — equipment **repository** layer (`clinicId` param) — separate, higher risk |
| Frontend/type hygiene; no equipment route behavior change | **Paused route extraction** — requires new approval track, not Slice 4 continuation |
| Optional follow-up: run full CI / integration suites before a large types PR | **POST /scan**, checkout, return, seen, `/:id/scan` — frozen until sign-off |

**Rationale:** Contract surfaces (320 routes, 109 query keys, G1 gates, 107 targeted tests) are stable on `main`. Extracted equipment handlers preserve middleware, replay, offline producers, and response contracts. Remaining risk is concentrated in the five **intentionally inline** custody/scan routes, which Slice 6 does not touch.

---

## Option A scope affirmation

This stabilization pass performed:

- Verification on current `main`
- This report only

This stabilization pass did **not**:

- Extract handlers or add repository code
- Modify paused routes (`POST /scan`, checkout, return, seen, `/:id/scan`)
- Implement Slice 6 or Slice 5

---

## Related docs

- [equipment-inline-mutations-inventory.md](../architecture/equipment-inline-mutations-inventory.md)
- [modularization-plan.md](../architecture/modularization-plan.md)
- [governance-known-limitations.md](../architecture/governance-known-limitations.md)
