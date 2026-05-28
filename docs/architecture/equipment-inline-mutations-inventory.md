# Equipment route — remaining inline mutations inventory (Slice 4f+)

**Status:** Documentation / inventory only (2026-05-28, updated after **4g / 4i / 4h** merge).  
**Source:** `server/routes/equipment.ts` on `main` after Slices **4d**–**4f-1** and **4g** (`POST /bulk-verify-room`, #541), **4i** (`POST /bulk-move`, #543), **4h** (`POST /import`, #542).  
**Scale:** `equipment.ts` ≈ **1,707 lines** (down from ~2,143 pre–4g).  
**Out of scope for this file:** read handlers under `server/routes/equipment/handlers/`; CSV helpers in `equipment-import-csv.ts`; waitlist routes in `server/routes/equipment-waitlist.ts` (mounted at bottom of `equipment.ts`).

---

## Already extracted (not inline)

| Method | Path | Handler module | Merged |
|--------|------|----------------|--------|
| `DELETE` | `/api/equipment/:id` | `handlers/delete-equipment.ts` | 4e |
| `POST` | `/api/equipment/:id/restore` | `handlers/post-equipment-restore.ts` | 4d |
| `POST` | `/api/equipment/:id/revert` | `handlers/post-equipment-revert.ts` | 4f-1 (`consumeUndoToken` in `equipment-undo-tokens.ts`) |
| `POST` | `/api/equipment/bulk-verify-room` | `handlers/post-equipment-bulk-verify-room.ts` | **4g** (#541) |
| `POST` | `/api/equipment/bulk-move` | `handlers/post-equipment-bulk-move.ts` | **4i** (#543) |
| `POST` | `/api/equipment/import` | `handlers/post-equipment-import.ts` (+ `equipment-import-csv.ts`) | **4h** (#542) |

Router still owns middleware registration (including replay idempotency on delete). Import route keeps `upload.single("file")` on the router.

**Tests:** `tests/equipment-pilot-verification.test.ts` asserts bulk-verify contract against the extracted handler module (#541).

---

## Inline mutation inventory (8 remaining)

Legend: **Replay** = `equipmentReplayIdempotency` on router. **Offline** = `src/lib/api/equipment.ts` enqueues `addPendingSync` / `handleOptimisticMutation` for that path (online-only if “No”).

| # | Method | Path | Middleware stack (order) | Replay | Offline producer | Audit | Realtime / outbox | Billing / inventory / waitlist | Approx. risk |
|---|--------|------|---------------------------|--------|------------------|-------|-------------------|-------------------------------|--------------|
| 1 | `POST` | `/` | `requireAuth` → `writeLimiter` → `requireEffectiveRole("technician")` → `validateBody(createEquipmentSchema)` → **replay(create)** | Yes | Yes (`offlineType: "create"`) | Yes (`equipment_created`) | No | No (sets V1 custody/readiness defaults on insert) | Medium |
| 2 | `PATCH` | `/:id` | `requireAuth` → `writeLimiter` → `requireEffectiveRole("technician")` → `validateUuid("id")` → `validateBody(patchEquipmentSchema)` → **replay(update)** | Yes | Yes (`offlineType: "update"`) | Yes (`equipment_updated`) | No | No (optional `transferLogs` + push on folder change; optimistic `version` OCC) | Medium–high |
| 3 | `POST` | `/scan` | `requireAuth` → `checkoutLimiter` → `requireEffectiveRole("student")` → `validateBody(quickScanBodySchema)` | **No** | **No** (no `api.equipment` helper; server/pilot path) | Yes (`equipment_checked_out` / `equipment_returned`, `via: quick_scan`) | No | Light (inline checkout/return + `scanLogs` + `undoTokens`; return branch inserts `equipmentReturns` with `isPluggedIn: true`) | **Paused — high** |
| 4 | `POST` | `/:id/checkout` | `requireAuth` → `checkoutLimiter` → `requireEffectiveRole("student")` → `validateUuid("id")` → `validateBody(checkoutSchema)` → **replay(checkout)** | Yes | Yes (`syncType: "checkout"`) | Yes (`equipment_checked_out`; emergency: `equipment_emergency_checkout`) | Yes (`EQUIPMENT_CUSTODY_STATE_CHANGED`; emergency: `EQUIPMENT_EMERGENCY_CHECKOUT`) | **Yes** — waitlist hold check, `fulfillWaitlistOnCheckout`, staging queue fulfill, V1 bundle/custody gates, `scheduleSmartReturnReminder` | **Paused — highest** |
| 5 | `POST` | `/:id/return` | `requireAuth` → `checkoutLimiter` → `requireEffectiveRole("student")` → `validateUuid("id")` → `validateBody(equipmentReturnBodySchema)` → **replay(return)** | Yes | Yes (`syncType: "return_with_charge"`) | Yes (`equipment_returned`) | Yes (`EQUIPMENT_CUSTODY_STATE_CHANGED` on custody transition) | **Yes** — `promoteNextWaitlistInTx`, `equipmentReturns` + `enqueueChargeAlertJob` when unplugged, `cancelSmartReturnReminder` | **Paused — highest** |
| 6 | `POST` | `/:id/seen` | `requireAuth` → `writeLimiter` → `validateUuid("id")` → `validateBody(seenSchema)` → **replay(seen)** | Yes | Yes (`type: "seen"`) | No (delegates to `recordEquipmentSeen` service) | Via service | **Yes** — `recordEquipmentSeen` → usage session + billing ledger idempotency | **Paused — high** |
| 7 | `POST` | `/:id/scan` | `requireAuth` → `scanLimiter` → `requireEffectiveRole("student")` → `validateUuid("id")` → `validateBody(scanSchema)` → **replay(scan)** | Yes | Yes (`type: "scan"`) | Yes (`equipment_scanned`) | No | No (scan logs + undo tokens; push on issue/maintenance/sterilization) | **Paused — high** |
| 8 | `POST` | `/bulk-delete` | `requireAuth` → `writeLimiter` → `requireAdmin` → `validateBody(bulkIdsSchema)` | No | No | Yes (`equipment_bulk_deleted`; **inside** transaction) | No | No (batch soft-delete + scan log per item) | Medium |

### Notes

- **Replay registry** (`server/lib/equipment-replay-idempotency.ts`): `create`, `update`, `delete`, `checkout`, `return`, `seen`, `scan` (`POST /api/equipment/:id/scan` only). `POST /api/equipment/scan` (quick-scan) is **not** in the replay endpoint map.
- **DELETE** replay middleware remains on the router; handler body is extracted (`delete-equipment.ts`).
- **PATCH** does not emit outbox events; folder transfer may send push notifications only.
- **POST /:id/seen** keeps business logic in `recordEquipmentSeen()` — extraction should move the thin route wrapper only unless a deliberate service refactor is scoped.
- **Removed from inline table (merged):** `POST /import`, `POST /bulk-move`, `POST /bulk-verify-room`.

---

## Related routes (not inline in `equipment.ts`)

Mounted via `mountEquipmentWaitlistRoutes(router)` from `server/routes/equipment-waitlist.ts`:

| Method | Path | Middleware | Replay | Offline | Audit | Outbox | Coupling |
|--------|------|------------|--------|---------|-------|--------|----------|
| `GET` | `/:id/waitlist` | `requireAuth`, `requireEffectiveRole("student")`, `validateUuid` | No | No | No | No | Waitlist snapshot service |
| `POST` | `/:id/waitlist` | same | No | No | Yes (`equipment_waitlist_joined`) | Service-driven | Waitlist join |
| `DELETE` | `/:id/waitlist` | same | No | No | Yes (`equipment_waitlist_left`) | Service-driven | Waitlist leave |

Checkout/return paths above already call waitlist services; do not extract waitlist mounts in the same slice as custody mutations without an ADR.

---

## Recommended extraction order (handler body only)

Policy: keep **all middleware** (including `equipmentReplayIdempotency`) on `router.*` in `equipment.ts`; one handler per PR; run `pnpm routes:contract` + targeted offline/replay tests after each.

### Completed (merged to `main`)

| Slice | Route | PR |
|-------|-------|-----|
| **4g** | `POST /bulk-verify-room` | #541 |
| **4i** | `POST /bulk-move` | #543 |
| **4h** | `POST /import` | #542 |

### Next (not paused)

| Order | Route | Rationale |
|-------|-------|-----------|
| **4j** | `POST /bulk-delete` | No replay; audit-in-transaction quirk to preserve; mirror single delete semantics. |
| **4k** | `POST /` (create) | Replay + offline `create`; sets operational state defaults — test replay + registry. |
| **4l** | `PATCH /:id` | Replay + offline `update` + version OCC + transfer side effects. |

### Pause — explicit slice + review (do not schedule as pre-pause slices)

| Route | Rationale |
|-------|-----------|
| `POST /scan` (quick-scan) | **No** replay middleware; toggle overlaps checkout/return semantics — requires product/engineering sign-off before any extraction (Codex P2 on #538). |
| `POST /:id/checkout` | Waitlist, staging, V1 gates, outbox, emergency branch, offline checkout. |
| `POST /:id/return` | Waitlist promotion, charge-alert worker, returns table, outbox, offline `return_with_charge`. |
| `POST /:id/seen` | Replay + offline `seen`; billing via `recordEquipmentSeen` — high coupling. |
| `POST /:id/scan` | Replay + offline `scan` + undo tokens + push side effects. |

**Do not start** checkout, return, quick-scan (`POST /scan`), `POST /:id/scan`, or `POST /:id/seen` until product/engineering sign-off on replay + offline + realtime test matrix (per post–4e stabilization pause).

---

## Verification commands (when extracting)

```bash
pnpm architecture:gates
npx tsc --noEmit
pnpm routes:contract          # expect 320/320 if paths unchanged
pnpm test -- tests/phase-5-route-error-contract.test.js \
  tests/equipment-replay-idempotency.routes.test.ts \
  tests/offline-mutation-registry.test.ts \
  tests/equipment-return-custody.test.ts \
  tests/equipment-pilot-verification.test.ts
```

Add integration tests when touching checkout/return/seen (`tests/equipment-replay-idempotency.integration.test.ts`, `tests/equipment-operational-state.integration.test.ts`).

---

## Related docs

- [modularization-plan.md](./modularization-plan.md) — Slice 4 roadmap
- [governance-known-limitations.md](./governance-known-limitations.md) — post–4d/4e/4g–4i stabilization observations
- [offline-realtime-invariants.md](./offline-realtime-invariants.md) — frozen transport / emergency doctrine
