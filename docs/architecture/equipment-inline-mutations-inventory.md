# Equipment route — remaining inline mutations inventory (Slice 4f)

**Status:** Documentation / inventory only (2026-05-28).  
**Source:** `server/routes/equipment.ts` on `main` after Slices **4d** (`POST /:id/restore`) and **4e** (`DELETE /:id`).  
**Out of scope for this file:** read handlers under `server/routes/equipment/handlers/`; waitlist routes in `server/routes/equipment-waitlist.ts` (mounted at bottom of `equipment.ts`).

---

## Already extracted (not inline)

| Method | Path | Handler module |
|--------|------|----------------|
| `DELETE` | `/api/equipment/:id` | `handlers/delete-equipment.ts` |
| `POST` | `/api/equipment/:id/restore` | `handlers/post-equipment-restore.ts` |
| `POST` | `/api/equipment/:id/revert` | `handlers/post-equipment-revert.ts` (Slice **4f-1**; `consumeUndoToken` in `equipment-undo-tokens.ts`) |

Router still owns middleware registration (including replay idempotency on delete).

---

## Inline mutation inventory (11 remaining)

Legend: **Replay** = `equipmentReplayIdempotency` on router. **Offline** = `src/lib/api/equipment.ts` enqueues `addPendingSync` / `handleOptimisticMutation` for that path (online-only if “No”).

| # | Method | Path | Middleware stack (order) | Replay | Offline producer | Audit | Realtime / outbox | Billing / inventory / waitlist | Approx. risk |
|---|--------|------|---------------------------|--------|------------------|-------|-------------------|-------------------------------|--------------|
| 1 | `POST` | `/` | `requireAuth` → `writeLimiter` → `requireEffectiveRole("technician")` → `validateBody(createEquipmentSchema)` → **replay(create)** | Yes | Yes (`offlineType: "create"`) | Yes (`equipment_created`) | No | No (sets V1 custody/readiness defaults on insert) | Medium |
| 2 | `PATCH` | `/:id` | `requireAuth` → `writeLimiter` → `requireEffectiveRole("technician")` → `validateUuid("id")` → `validateBody(patchEquipmentSchema)` → **replay(update)** | Yes | Yes (`offlineType: "update"`) | Yes (`equipment_updated`) | No | No (optional `transferLogs` + push on folder change; optimistic `version` OCC) | Medium–high |
| 3 | `POST` | `/scan` | `requireAuth` → `checkoutLimiter` → `requireEffectiveRole("student")` → `validateBody(quickScanBodySchema)` | **No** | **No** (no `api.equipment` helper; server/pilot path) | Yes (`equipment_checked_out` / `equipment_returned`, `via: quick_scan`) | No | Light (inline checkout/return + `scanLogs` + `undoTokens`; return branch inserts `equipmentReturns` with `isPluggedIn: true`) | High |
| 4 | `POST` | `/:id/checkout` | `requireAuth` → `checkoutLimiter` → `requireEffectiveRole("student")` → `validateUuid("id")` → `validateBody(checkoutSchema)` → **replay(checkout)** | Yes | Yes (`syncType: "checkout"`) | Yes (`equipment_checked_out`; emergency: `equipment_emergency_checkout`) | Yes (`EQUIPMENT_CUSTODY_STATE_CHANGED`; emergency: `EQUIPMENT_EMERGENCY_CHECKOUT`) | **Yes** — waitlist hold check, `fulfillWaitlistOnCheckout`, staging queue fulfill, V1 bundle/custody gates, `scheduleSmartReturnReminder` | **Highest** |
| 5 | `POST` | `/:id/return` | `requireAuth` → `checkoutLimiter` → `requireEffectiveRole("student")` → `validateUuid("id")` → `validateBody(equipmentReturnBodySchema)` → **replay(return)** | Yes | Yes (`syncType: "return_with_charge"`) | Yes (`equipment_returned`) | Yes (`EQUIPMENT_CUSTODY_STATE_CHANGED` on custody transition) | **Yes** — `promoteNextWaitlistInTx`, `equipmentReturns` + `enqueueChargeAlertJob` when unplugged, `cancelSmartReturnReminder` | **Highest** |
| 6 | `POST` | `/:id/seen` | `requireAuth` → `writeLimiter` → `validateUuid("id")` → `validateBody(seenSchema)` → **replay(seen)** | Yes | Yes (`type: "seen"`) | No (delegates to `recordEquipmentSeen` service) | Via service | **Yes** — `recordEquipmentSeen` → usage session + billing ledger idempotency | High |
| 7 | `POST` | `/:id/scan` | `requireAuth` → `scanLimiter` → `requireEffectiveRole("student")` → `validateUuid("id")` → `validateBody(scanSchema)` → **replay(scan)** | Yes | Yes (`type: "scan"`) | Yes (`equipment_scanned`) | No | No (scan logs + undo tokens; push on issue/maintenance/sterilization) | High |
| 8 | `POST` | `/import` | `requireAuth` → `writeLimiter` → `requireAdmin` → `upload.single("file")` | No | No (`importCsv` uses raw `fetch`, no `addPendingSync`) | Yes (`equipment_imported`) | No | No (batch insert equipment rows) | Medium |
| 9 | `POST` | `/bulk-delete` | `requireAuth` → `writeLimiter` → `requireAdmin` → `validateBody(bulkIdsSchema)` | No | No | Yes (`equipment_bulk_deleted`; **inside** transaction) | No | No (batch soft-delete + scan log per item) | Medium |
| 10 | `POST` | `/bulk-move` | `requireAuth` → `writeLimiter` → `requireEffectiveRole("technician")` → `validateBody(bulkMoveSchema)` | No | No | Yes (`equipment_bulk_moved`) | No | No (`transferLogs` per item; post-response push) | Medium |
| 11 | `POST` | `/bulk-verify-room` | `requireAuth` → `requireEffectiveRole("technician")` → `validateBody(bulkVerifyRoomSchema)` | No | No | Yes (`room_bulk_verified`) | No | No (room `syncStatus`; batch verify + scan logs) | Low–medium |

### Notes

- **Replay registry** (`server/lib/equipment-replay-idempotency.ts`): `create`, `update`, `delete`, `checkout`, `return`, `seen`, `scan` (`POST /api/equipment/:id/scan` only). `POST /api/equipment/scan` (quick-scan) is **not** in the replay endpoint map.
- **DELETE** replay middleware remains on the router; handler body is extracted (`delete-equipment.ts`).
- **PATCH** does not emit outbox events; folder transfer may send push notifications only.
- **POST /:id/seen** keeps business logic in `recordEquipmentSeen()` — extraction should move the thin route wrapper only unless a deliberate service refactor is scoped.

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

| Order | Route | Rationale |
|-------|-------|-----------|
| **4g** | `POST /bulk-verify-room` | Batch verify only; no replay/offline; room + scan logs. |
| **4h** | `POST /import` | Admin-only; multer + CSV; no replay/offline; large but isolated. |
| **4i** | `POST /bulk-move` | No replay; transfer logs + push; no waitlist/billing. |
| **4j** | `POST /bulk-delete` | No replay; audit-in-transaction quirk to preserve; mirror single delete semantics. |
| **4k** | `POST /` (create) | Replay + offline `create`; sets operational state defaults — test replay + registry. |
| **4l** | `PATCH /:id` | Replay + offline `update` + version OCC + transfer side effects. |
| **4m** | `POST /:id/seen` | Replay + offline `seen`; keep `recordEquipmentSeen` call; billing tests required. |
| **4n** | `POST /:id/scan` | Replay + offline `scan` + undo tokens + push side effects. |

### Pause — explicit slice + review (do not schedule as pre-pause slices)

| Route | Rationale |
|-------|-----------|
| `POST /scan` (quick-scan) | **No** replay middleware; toggle overlaps checkout/return semantics — requires product/engineering sign-off before any extraction (Codex P2 on #538). |
| `POST /:id/checkout` | Waitlist, staging, V1 gates, outbox, emergency branch, offline checkout. |
| `POST /:id/return` | Waitlist promotion, charge-alert worker, returns table, outbox, offline `return_with_charge`. |

**Do not start** checkout, return, or quick-scan (`POST /scan`) until product/engineering sign-off on replay + offline + realtime test matrix (per post–4e stabilization pause).

---

## Verification commands (when extracting)

```bash
pnpm architecture:gates
npx tsc --noEmit
pnpm routes:contract          # expect 320/320 if paths unchanged
pnpm test -- tests/phase-5-route-error-contract.test.js \
  tests/equipment-replay-idempotency.routes.test.ts \
  tests/offline-mutation-registry.test.ts \
  tests/equipment-return-custody.test.ts
```

Add integration tests when touching checkout/return/seen (`tests/equipment-replay-idempotency.integration.test.ts`, `tests/equipment-operational-state.integration.test.ts`).

---

## Related docs

- [modularization-plan.md](./modularization-plan.md) — Slice 4 roadmap
- [governance-known-limitations.md](./governance-known-limitations.md) — post–4d/4e stabilization observations
- [offline-realtime-invariants.md](./offline-realtime-invariants.md) — frozen transport / emergency doctrine
