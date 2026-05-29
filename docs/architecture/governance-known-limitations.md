# Architecture governance — known limitations (G3–G5)

**Status:** Enforcement **paused at warn-only** (2026-05). G3–G5 run in CI with `continue-on-error: true` and exit 0 by default. **Do not flip to merge-blocking** until observation below is reviewed and G6 is agreed.

**Governance stack merged to `main` (2026-05-27):** [#517](https://github.com/dboy3156/VetTrack/pull/517) G1 → [#522](https://github.com/dboy3156/VetTrack/pull/522) G2 (replaces stuck #518) → [#523](https://github.com/dboy3156/VetTrack/pull/523) G3 → [#524](https://github.com/dboy3156/VetTrack/pull/524) G4 → [#525](https://github.com/dboy3156/VetTrack/pull/525) G5. Close superseded open PRs #518–#521 when convenient.

**Rebase rule:** Feature PRs branched before the stack merge do **not** run G3–G5 in CI until rebased onto current `main`.

| Gate | Script / command | CI today |
|------|------------------|----------|
| G3 Tenant query lint | `pnpm tenant:lint:touched` | Warn only |
| G4 Query key registry | `pnpm query-keys:audit` | Warn only |
| G5 Route contract | `pnpm routes:contract` | Warn only |
| G1 (depcruise, madge, tsc) | `pnpm architecture:gates` | **Blocking** (unchanged) |

---

## G3 — Tenant query lint (`tenant-query-lint.mjs`)

### What it checks

Heuristic: Drizzle `.from(<tenantTable>)` inside a function body must contain the identifier `clinicId` or `<table>.clinicId` in that **brace-delimited** body.

Waivers: `// tenant-lint:scoped <reason>` on the same line or up to two lines above the `.from(...)`.

### Recurring false positives (baseline ~245 on full `server/` scan)

| Pattern | Why it fires | Typical action |
|---------|----------------|----------------|
| **`clinicId` only in function parameters** | Scope check uses `{ ... }` body only; parameters are excluded. Affects most handlers that filter with `eq(table.clinicId, clinicId)`. | Waiver with reason, or wait for G6 scope fix. |
| **`eq(table.clinicId, clinicId)` in `.where()`** | Same as above when `clinicId` is not repeated elsewhere in the body. | Usually safe; waiver or ignore until scope fix. |
| **Intentional non-tenant lookup** | e.g. `auth.ts` Clerk user resolution by `clerkId` without clinic filter. | Waiver: `// tenant-lint:scoped clerk lookup by clerkId before clinic resolution`. |
| **Cross-clinic / system workers** | Workers that iterate clinics or load config before `clinicId` is in scope. | Waiver + code review; do not “fix” by removing filters elsewhere. |
| **Nested arrow callbacks** | Inner `.from()` may be attributed to outer function missing `clinicId`. | Refactor rare; prefer waiver on inner query. |

### Not detected (false negatives)

- Tenancy satisfied only via join (`INNER JOIN ... ON clinic_id`) without `eq(targetTable.clinicId, ...)`.
- Raw SQL / `db.execute` strings.
- `clinicId` under another name (`c`, `tenantId`, `scope.clinicId`) without bare `clinicId` token.

### Observation checklist for feature PRs

- [ ] Note warn count on touched files (`pnpm tenant:lint:touched`).
- [ ] If new warnings are **parameter-only** filters, record here — do not block merge during pause.
- [ ] Real misses (no `clinicId` in params or `where`) → fix in PR, not waiver.

---

## G4 — Query key registry (`collect-query-keys.mjs`)

### What it checks

Collects normalized TanStack `queryKey` tuple shapes from `src/` (string literals + `*QUERY_KEY` constants). Compares to `src/lib/query-keys/registry.ts`. **Does not** change runtime keys or invalidation.

### Recurring noise (by design in warn mode)

| Pattern | Notes |
|---------|--------|
| **New key in PR** | Drift until author runs `pnpm query-keys:audit -- --write-registry`. Expected during pause. |
| **Dynamic segments** | Normalized to `"*"`; `["/api/foo", id]` and `["/api/foo", other]` share one signature. |
| **Invalidate vs useQuery** | Invalidation-only keys must still be registered when they use a distinct tuple shape. |
| **Const aliases** | `queryKey: ER_MODE_QUERY_KEY` resolved via `export const ... = [...] as const`. Unresolved imports skipped. |
| **Spread keys** | `[...DLQ_LIST_KEY, "initial"]` merged when const is in same file graph. |

### Registry file

- **Not imported at runtime** — audit baseline only.
- Parity: run `--write-registry` in the same PR that adds keys (optional during pause).

### Observation checklist for feature PRs

- [ ] New `queryKey` / invalidation tuple → note in PR; update registry if team wants zero warn noise.
- [ ] Do **not** rename keys to satisfy audit during pause (forbidden without invalidation audit).

---

## G5 — Route contract (`extract-express-routes.mjs`)

### What it checks

Static extraction of `app.use` mounts from `server/app/routes.ts` and `server/index.ts`, plus `router.get/post/...` and nested `router.use` in mounted modules. Output: `docs/architecture/routes-contract.json` (method, full path, source lines, `pilotGated`).

### Recurring limitations

| Pattern | Notes |
|---------|--------|
| **Duplicate logical routes** | Same handler file mounted at multiple prefixes (e.g. health on `/api/health`, `/api/health/ready`, `/health`) → multiple contract rows. Not a runtime bug. |
| **`pilotGated: true`** | Static: mount appears inside `if (!isPilotMode)` in `routes.ts`. Runtime still depends on env (`PILOT_MODE`, `ALLOW_EQUIPMENT_PILOT_MODE`). |
| **Multiline `router.post(`** | First string arg after `(` is parsed; paths on later lines may be missed if not the first token. |
| **Middleware-only `router.use`** | `router.use(requireAuth)` ignored; sub-routers with string prefix are followed. |
| **Non-`server/routes` routers** | Index mounts (Clerk webhooks, RFID, integration webhooks) included; Vite/dev-only routes excluded. |
| **Contract bump** | Method or path change → drift until `--write-contract`. |

### Observation checklist for feature PRs

- [ ] New route → expect CI warn until contract regenerated.
- [ ] Confirm `pilotGated` flag matches product intent for new mounts.
- [ ] No API path changes “hidden” from contract (same method+path must appear).

---

## Observation log (feature / refactor PRs)

Recorded after stack merge; audits run from `main` tooling against PR heads (local replay). CI on GitHub will match once the PR branch includes #517–#525.

### PR [#499](https://github.com/dboy3156/VetTrack/pull/499) — pilot env / feature-flag cleanup

| Gate | Result | Notes |
|------|--------|--------|
| G3 `tenant:lint` (touched `server/`) | **0 warnings** | Touched: `routes.ts`, `build-info.ts`, `envValidation.ts` — no new `.from()` in diff. |
| G4 `query-keys:audit` | **No drift** | Diff removes some `invalidateQueries` lines in `event-reducer.ts` / RFID helper; no new tuple shapes. |
| G5 `routes:contract` | **No mount churn** | `server/app/routes.ts` import/plumbing only; no `app.use` path/method changes detected in diff. |

**Takeaway:** Low noise for server-only config PRs. Rebase onto `main` so CI warn steps execute.

### PR [#498](https://github.com/dboy3156/VetTrack/pull/498) — tests + waitlist / server touch

| Gate | Result | Notes |
|------|--------|--------|
| G3 `tenant:lint` (all touched `server/` files) | **23 warnings** | All in files already on `main` (`equipment.ts`, `rooms.ts`, `task-automation.service.ts`, `notification.worker.ts`, `rfid-ingest.ts`). Typical **parameter-scope false positives**; not introduced by this PR’s logic. |
| G4 `query-keys:audit` | **N/A** (no `queryKey` edits) | Diff only removes invalidation lines in client helpers. |
| G5 `routes:contract` | **Not re-run on branch** | Touches `routes.ts` / `index.ts`; expect warn-only contract drift only if mounts change — verify after rebase with `pnpm routes:contract`. |

**Takeaway:** **Touched-file mode is noisy** when a PR edits a large route file for unrelated reasons: CI will list every legacy `.from()` in that file. Prefer interpreting warnings as “file needs baseline waivers / G6 scope fix,” not “this PR broke tenancy.” Do **not** block merge during pause.

### Modularization stabilization — [#527](https://github.com/dboy3156/VetTrack/pull/527) + [#528](https://github.com/dboy3156/VetTrack/pull/528) on `main` (2026-05-28)

**Scope:** Frontend file moves only (`request-core.ts`, `api/equipment.ts`); `api.equipment` barrel unchanged. **Slice 4 (server route extraction) not started.**

| Area | Check | Result |
|------|--------|--------|
| Equipment list/detail | URLs `/api/equipment`, `/api/equipment/:id`; Dexie fallback on `isNetworkError` | **OK** — static + unit contracts pass |
| Checkout / return | `POST …/checkout`, `POST …/return`; `syncType: "return_with_charge"` | **OK** — `equipment-return-custody`, `return-plug-dialog` tests |
| Offline fallback | `addPendingSync` in `api/equipment.ts` + `request-core.ts`; activity uses `requestWithOfflineFallback` | **OK** — `offline-mutation-registry`, phase-5/6 sync tests |
| Auth 401 redirect | `throwIfUnauthorized` in `request-core`; bootstrap still raw `fetch` in `api.ts` | **OK** — `auth-bootstrap-fetch` tests |
| Realtime equipment | `event-reducer.ts` → `invalidateEquipmentCaches` (unchanged) | **OK** — `event-reducer-rfid`, `invalidate-equipment-rfid-caches` tests |
| Main CI post-merge | `26549315194` | **success** (tests, architecture gates, Playwright) |

**Follow-up for Slice 4:** Any static test that greps `src/lib/api.ts` for equipment offline strings should read `src/lib/api/equipment.ts` instead (done for return contracts in #528).

### Post–Slice 4a–4c stabilization — equipment read extraction on `main` (2026-05-28)

**Scope:** Observation only — no refactors in this pass. Server read handlers extracted in [#530](https://github.com/dboy3156/VetTrack/pull/530) (4a), [#531](https://github.com/dboy3156/VetTrack/pull/531) (4b), [#532](https://github.com/dboy3156/VetTrack/pull/532) (4c). Mutations remain inline in `server/routes/equipment.ts` (~2,368 lines).

| Area | Check | Result |
|------|--------|--------|
| **GET reads (8 handlers)** | `GET /`, `/my`, `/deleted`, `/critical`, `/pilot-coverage`, `/:id`, `/:id/logs`, `/:id/transfers` | **OK** — wired in `equipment.ts`; bodies under `server/routes/equipment/handlers/` |
| **List pagination shape** | `{ items, total, page, pageSize, hasMore }` in `get-equipment-list.ts` | **OK** — unchanged from pre-4c |
| **Operational + RFID projection** | `equipmentOperationalStateSelect` + `equipmentRfidSelect(clinicId)` on list/detail/my | **OK** — `equipment-operational-state-serialization.contract.test.ts` |
| **Tenant filters (list)** | `eq(equipment.clinicId, clinicId)`, `isNull(equipment.deletedAt)`; scoped joins | **OK** — handler-only move |
| **Offline list fallback** | `api.equipment.list` / `listPaginated` → Dexie on `isNetworkError` | **OK** — `src/lib/api/equipment.ts`; `offline-mutation-registry` |
| **RFID cache invalidation** | `invalidateEquipmentRfidCaches` + waitlist SSE list keys | **OK** — `invalidate-equipment-rfid-caches`, `event-reducer-rfid`, `equipment-waitlist-paginated-sse.contract` |
| **G5 routes:contract** | Full extract vs `routes-contract.json` | **OK** — **320 / 320**, no drift |
| **G4 query-keys:audit** | Registry parity | **OK** — **109 / 109**, no drift |
| **G1 architecture:gates** | tsc, depcruiser, madge | **OK** — src cycles 0; server baseline 4 |
| **Phase 5 error contract** | `equipment.ts` + `handlers/*.ts` bundle | **OK** — static test includes all handler modules |
| **Mutations untouched** | No `router.post/patch/delete` in `handlers/` | **OK** — POST/PATCH/DELETE still only in `equipment.ts` |
| **Main CI post #532** | `26551848381` (CI), `26551848355` (Playwright) | **success** |

**Local replay (post-merge `main`):** `pnpm routes:contract`, `pnpm query-keys:audit`, `pnpm architecture:gates`, and 113 tests across operational-state, phase-5, offline registry, RFID caches, return/custody, pilot verification, replay-idempotency routes — all passed.

**Proposed Slice 4d (first mutation, if next PR stays green):** extract **handler body only** for `POST /api/equipment/:id/restore` (~55 lines, admin-only, no `equipmentReplayIdempotency`, no offline `addPendingSync` producer). Keep `router.post("/:id/restore", requireAuth, requireAdmin, validateUuid("id"), …)` in `equipment.ts`. Defer checkout/return/scan/delete until restore extraction is stable.

### Post–Slice 4d stabilization — first equipment mutation extraction on `main` (2026-05-28)

**Scope:** Observation only after [#534](https://github.com/dboy3156/VetTrack/pull/534). **Do not** start scan/checkout/return extraction until a separate slice is approved.

| Area | Check | Result |
|------|--------|--------|
| **POST /:id/restore** | `res.json(restored)`; 404 `EQUIPMENT_NOT_FOUND_OR_NOT_DELETED`; 500 `EQUIPMENT_RESTORE_FAILED` | **OK** — `post-equipment-restore.ts` |
| **Audit** | `equipment_restored` + `metadata: { equipmentName }` | **OK** — unchanged |
| **Analytics cache** | `invalidateAnalyticsCache(clinicId)` after restore | **OK** |
| **Tenant** | `eq(equipment.clinicId, clinicId)` on select/update | **OK** |
| **Middleware (route file)** | `requireAuth`, `requireAdmin`, `validateUuid("id")` on `router.post` in `equipment.ts` | **OK** — handler body only moved |
| **Replay idempotency** | `equipmentReplayIdempotency` on create/update/delete/checkout/return/seen/scan only | **OK** — restore route has **no** replay middleware |
| **Offline** | `api.equipment.restore` — plain `request` POST, no `addPendingSync` | **OK** — `offline-mutation-registry` unchanged |
| **G5 routes:contract** | Full extract | **OK** — **320 / 320** |
| **G1 + targeted tests** | phase-5 error bundle (includes `handlers/*.ts`), replay-idempotency routes, offline registry, scan lifecycle | **OK** — 97 tests on post-merge `main` |
| **Main CI post #534** | Merge run on `main` | **success** (see merge commit `6c349ca0`) |
| **Handler inventory** | 8 GET + 1 POST under `handlers/`; ~2,316 lines remain in `equipment.ts` | **OK** |

**Next extraction (not started):** `DELETE /:id` or `POST /scan` only after explicit slice — both carry replay idempotency and/or offline-adjacent behavior; higher risk than restore.

### Post–Slice 4e stabilization — DELETE soft-delete extraction on `main` (2026-05-28)

**Scope:** Observation only after [#536](https://github.com/dboy3156/VetTrack/pull/536). **Do not** start scan, checkout, or return handler extraction.

| Area | Check | Result |
|------|--------|--------|
| **DELETE /:id** | `res.status(204).send()`; soft-delete `deletedAt` / `deletedBy` | **OK** — `delete-equipment.ts` |
| **Errors** | 404 `EQUIPMENT_NOT_FOUND`; 500 `EQUIPMENT_DELETE_FAILED` | **OK** |
| **Audit** | `equipment_deleted` + `metadata: { name, serialNumber }` | **OK** |
| **Analytics cache** | `invalidateAnalyticsCache(clinicId)` | **OK** |
| **Tenant** | `eq(equipment.clinicId, clinicId)` + `isNull(equipment.deletedAt)` on select/update | **OK** |
| **Middleware on router** | `writeLimiter`, `requireAdmin`, `validateUuid("id")`, `equipmentReplayIdempotency(…delete)` | **OK** — replay stays on `equipment.ts`, not in handler |
| **POST /:id/restore** | Unchanged (`post-equipment-restore.ts`) | **OK** |
| **High-risk routes** | scan, checkout, return, bulk, import — inline only | **OK** — diff is 2 files |
| **G5 routes:contract** | Full extract | **OK** — **320 / 320** |
| **Targeted tests** | phase-5, replay-idempotency routes, offline registry | **OK** — 59 tests on post-merge `main` |
| **Main CI post #536** | Merge commit `4bc60a3d` | **success** (pre-merge CI green) |
| **Handler inventory** | 8 GET + 2 mutations (`restore`, `delete`); ~2,269 lines in `equipment.ts` | **OK** |

**Paused until new slice:** `POST /scan`, `POST …/checkout`, `POST …/return` — replay idempotency + offline/sync consumers; do not extract without dedicated review.

### Post–Slice 4f-1 stabilization — revert extraction on `main` (2026-05-28)

**Scope:** Observation only after [#539](https://github.com/dboy3156/VetTrack/pull/539). **Do not** start checkout, return, or `POST /scan` (quick-scan) extraction.

| Area | Check | Result |
|------|--------|--------|
| **Route registration** | `requireAuth`, `requireEffectiveRole("vet")`, `validateUuid("id")`, `validateBody(revertSchema)` on `router.post` in `equipment.ts` | **OK** |
| **Undo token** | `consumeUndoToken` in `equipment-undo-tokens.ts` (same consume/update SQL as pre-extract) | **OK** |
| **Scan log delete** | `eq(scanLogs.clinicId)`, `eq(scanLogs.id, token.scanLogId)`, `eq(scanLogs.equipmentId, req.params.id)` | **OK** |
| **Audit / response** | `equipment_reverted`; `res.json(updated)` | **OK** |
| **Errors** | `EQUIPMENT_NOT_FOUND`, `UNDO_TOKEN_INVALID_OR_EXPIRED`, `EQUIPMENT_REVERT_FAILED` | **OK** |
| **Replay / offline** | Revert has **no** replay middleware; no new `addPendingSync` producer | **OK** |
| **High-risk routes** | checkout, return, `POST /scan`, bulk, import — still inline | **OK** |
| **G5** | **320 / 320** | **OK** |
| **Targeted tests** | phase-5, `equipment-scan-lifecycle`, return-custody, replay-idempotency routes | **OK** — 63 tests on post-merge `main` |
| **Main CI post #539** | Merge `a088ac21` | **success** (pre-merge CI green) |
| **Handlers** | 8 GET + 3 mutations; `equipment.ts` ~2,143 lines; colocated `equipment-undo-tokens.ts` for shared consume | **OK** |

**Next per [inventory](./equipment-inline-mutations-inventory.md):** `POST /bulk-verify-room` (4g) — not checkout/return/quick-scan.

### Post–Slice 4g / 4i / 4h stabilization — bulk admin routes on `main` (2026-05-28)

**Scope:** Observation only after [#541](https://github.com/dboy3156/VetTrack/pull/541) (bulk-verify-room), [#543](https://github.com/dboy3156/VetTrack/pull/543) (bulk-move), [#542](https://github.com/dboy3156/VetTrack/pull/542) (import). Handler-body extraction only; middleware remains on `equipment.ts`. **Do not** start checkout/return/scan/seen without pause sign-off.

| Area | Check | Result |
|------|--------|--------|
| **POST /bulk-verify-room** | `requireAuth` → `requireEffectiveRole("technician")` → `validateBody(bulkVerifyRoomSchema)` → handler | **OK** — `post-equipment-bulk-verify-room.ts` |
| **POST /bulk-move** | `requireAuth` → `writeLimiter` → `requireEffectiveRole("technician")` → `validateBody(bulkMoveSchema)` → handler | **OK** — `post-equipment-bulk-move.ts` |
| **POST /import** | `requireAuth` → `writeLimiter` → `requireAdmin` → `upload.single("file")` → handler | **OK** — `post-equipment-import.ts` + `equipment-import-csv.ts` (not a service layer) |
| **Import contract** | CSV reasons, row skip, `EQUIPMENT_IMPORT_FIELD_MAX_LENGTH` (500), `BATCH=50`, tenant-scoped folder/equipment lookups | **OK** — behavior preserved vs pre-extraction |
| **Pilot verification** | Bulk-verify assertions target handler module + router wiring | **OK** — `equipment-pilot-verification.test.ts` (#541) |
| **G5 routes:contract** | Full extract | **OK** — **320 / 320** |
| **G1 + targeted tests** | phase-5, replay-idempotency routes, offline registry, scan lifecycle, pilot verification | **OK** — **103** tests on post-merge `main` |
| **Handler inventory** | 8 GET + 6 mutation handlers under `handlers/`; **~1,707 lines** remain in `equipment.ts` | **OK** |
| **Inline mutations left** | create, PATCH, bulk-delete + **paused** quick-scan, checkout, return, seen, `/:id/scan` | **OK** — see [equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md) |

**Next extraction (not started):** `POST /bulk-delete` (4j) — no replay/offline; preserve audit-in-transaction. Paused routes unchanged.

### Post–Slice 4j / 4k / 4l stabilization — create, patch, bulk-delete on `main` (2026-05-28)

**Scope:** Observation only after [#548](https://github.com/dboy3156/VetTrack/pull/548) (bulk-delete), [#549](https://github.com/dboy3156/VetTrack/pull/549) (create), [#550](https://github.com/dboy3156/VetTrack/pull/550) (patch). Handler-body extraction only; middleware and replay idempotency remain on `equipment.ts`. **Do not** start paused checkout/return/scan/seen routes.

| Area | Check | Result |
|------|--------|--------|
| **POST /bulk-delete** | `requireAuth` → `writeLimiter` → `requireAdmin` → `validateBody(bulkIdsSchema)` → handler | **OK** — `post-equipment-bulk-delete.ts`; audit-in-transaction preserved |
| **POST /** (create) | `equipmentReplayIdempotency(create)` on router; V1 custody/readiness defaults in handler | **OK** — `post-equipment-create.ts`; offline `create` registry unchanged |
| **PATCH /:id** | `equipmentReplayIdempotency(update)` on router; version OCC + transfer logs + push | **OK** — `patch-equipment.ts` |
| **G5 routes:contract** | Full extract | **OK** — **320 / 320** |
| **G1 + targeted tests** | phase-5, replay-idempotency routes, offline registry, scan lifecycle, pilot verification | **OK** — **103** tests on post-merge `main` |
| **Handler inventory** | 8 GET + 9 mutation handlers under `handlers/`; **~1,386 lines** remain in `equipment.ts` | **OK** |
| **Inline mutations left** | **5 paused only:** `POST /scan`, checkout, return, seen, `POST /:id/scan` | **OK** — see [equipment-inline-mutations-inventory.md](./equipment-inline-mutations-inventory.md) |

**Next extraction:** None scheduled for Slice 4 until pause sign-off on custody/scan/seen routes.

### Cross-PR recurring issues (confirmed)

1. **G3:** Parameter / `.where()` tenancy is correct but flagged (~245 repo-wide; ~20+ per large route touch).
2. **G4:** Zero drift when keys unchanged; registry update only when adding tuples.
3. **G5:** Contract drift only when `app.use` or `router.*` paths change; import-only edits are quiet.
4. **CI visibility:** Old branches lack workflow steps until rebased.

---

## Proposed G6 (not implemented — do not enable yet)

**Goal:** Block **new** violations in **newly created or touched paths** only; grandfather existing debt.

| Tool | Proposed G6 behavior |
|------|----------------------|
| G3 Tenant lint | `--strict` on touched files only; **fix parameter-scope detection first**; block only unwaived **new** findings vs a touched-file baseline (or allowlist file). Do not block on legacy lines in touched files. |
| G4 Query keys | `--strict` when new signatures appear in diff without registry update. |
| G5 Route contract | `--strict` when method+path added/removed without `contractVersion` bump + `--write-contract`. |
| G1 | Remains blocking (unchanged). |

**Prerequisites before G6:**

1. Merge G1–G5 stack (#517 → #521).
2. Observe 1–2 feature/refactor PRs with warn-only; append findings to this doc.
3. Reduce tenant-lint false positives (parameter scope) or maintain touched-file allowlist.
4. Team agreement on registry/contract update duty in PR template.

---

## Related docs

- [architecture-hardening-addendum.md](./architecture-hardening-addendum.md) — full fitness-function plan
- [tenant-enforcement.md](./tenant-enforcement.md) — real tenancy rules (human review)
- [frontend-feature-ownership.md](./frontend-feature-ownership.md) — query key discipline
- [backend-routing.md](./backend-routing.md) — route contract usage
