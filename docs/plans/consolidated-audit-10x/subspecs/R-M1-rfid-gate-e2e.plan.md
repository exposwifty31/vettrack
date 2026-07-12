# R-M1 — RFID-gate tracking, end-to-end (SUB-SPEC + plan)

- **Covers:** massive-01 (spec §8). Technology **LOCKED: RFID-gate**. Scope **LOCKED (owner)**: managed reader entity + true directional gates.
- **Spec:** `../../../superpowers/specs/2026-07-12-audit-10x-consolidated-plan-design.md` · **Cost/benefit:** `../../../business-case/2026-07-12-massive-01-passive-tracking-cost-benefit.md`
- **Gating:** **hardware rollout** is gated on the manager go. **The software is green-lit to build and e2e-verify NOW** with **simulated reader payloads** (no hardware needed) so the single-clinic pilot is turnkey when readers install.
- **Card contract:** SDD requirement (`R-M1-#`) → TDD card(s) RED→GREEN→verify. Exact anchors; frozen-surface guardrails per card.

## Current state (grounded 2026-07-12) — build on what exists, don't duplicate

**Already wired (do NOT rebuild):**
- Ingest: `POST /api/rfid/events` (`server/routes/rfid.ts:37`), `RfidBatchSchema` (`:18-31`), `ingestRfidBatch` (`server/lib/rfid-ingest.ts`), HMAC via `verifyVetTrackWebhookSignature` + `getCredentials(clinicId,"rfid")`, feature flag `isRfidIngestEnabled` (`server/lib/rfid/config.ts`), rate limiter `rfidEventLimiter`.
- Data: `vt_equipment_rfid_reads` (`server/schema/equipment.ts:164-186`); `equipment.lastRfid*` (`:124-127`); `rooms.gatewayCode` (`:33`); `vt_docks` (`:48-63`).
- Resolve/render: evidence resolver consumes `recentRfidReads`; equipment-list "Last seen via RFID near {room}" subtitle + attention badge (`src/pages/equipment-list.tsx:1252-1268`, `src/lib/equipment-rfid-display.ts`); smoke runbook `docs/rfid-smoke.md`.

**Inert / missing (this plan's work):**
1. Command Board `rfid` / `evidenceConflict` / `rfid_reader_offline` contract (`shared/equipment-board.ts:18-20,28-31,84`) has **no producer** in `equipment-command-board.service.ts`.
2. Reader management is **script + manual** (`scripts/rfid/provision-secret.ts`, hand-flip `vt_server_config` key `rfid.ingest_enabled.<clinicId>`); `/admin/rfid-readers` (`src/pages/console/RfidReadersConsolePage.tsx`, `api.rfidReaders.list()` at `src/lib/api.ts:823-828`) is **read-only**; a "reader" is *inferred* (`server/services/rfid-readers.service.ts`, `shared/rfid-readers.ts` — "no reader entity").
3. Two resolvers **disagree on RFID precedence** (`equipment-location-inference.ts` lowest-confidence vs evidence-graph `resolver/location.ts:78-89` outranks authoritative room).
4. **No gate direction** — `gatewayCode` maps 1:1 to a room; no entered/exited, no adjacency.
5. Thin tests (`tests/equipment-inference.test.ts` covers the inference ladder only).

**Non-goal (preserve):** RFID **never mutates custody** (`ingestRfidBatch` only touches `lastRfid*` + inserts reads; wedge plan Part L.3). No card may add a custody write on the RFID path.

## Build order
M1.0 (reconcile precedence — correctness) → M1.1 (managed reader entity) → M1.2 (directional gates) → M1.3 (board producer) → M1.4 (surface direction) → M1.5 (e2e golden).

---

### R-M1.0 · Reconcile the resolver-precedence conflict (correctness)
- **Files:** `server/services/equipment-location-inference.ts` (RFID lowest tier ~L193-204); `server/domain/equipment/evidence/resolver/location.ts:78-89` (RFID outranks `eq.roomId`); `custodian.ts:55,67-76` (RFID corroboration).
- **Decision (canonical precedence — confirm at build):** active checkout/scan-confirmed location > **human-confirmed `roomId`** > RFID last-seen (passive, no accountable person) > free-text > unknown. RFID may **raise confidence / corroborate** but must **not override** a human-confirmed room. → the evidence-graph summary ordering (`location.ts:78-89`) is the bug; align it to the inference-service ladder.
- **RED:** `tests/rfid-resolver-precedence.test.ts` — equipment with an authoritative `roomId` AND a conflicting recent RFID read → both resolvers return the authoritative room in the summary; RFID appears as a citation/corroboration only. Fails now (evidence-graph resolver picks RFID).
- **GREEN:** make `resolveCurrentLocation` rank authoritative room above RFID; keep RFID as a citation.
- **Guardrail:** don't change the ingest or the reads table; resolver-read logic only.
- **Verify:** `pnpm test -- tests/rfid-resolver-precedence.test.ts && pnpm typecheck`.

### R-M1.1 · Managed reader entity (replaces script/manual flow)
Promote "reader" from inferred to a first-class managed entity with CRUD + provisioning + health.

- **a) schema** — `vt_rfid_readers` (`clinicId, id, name, gatewayCode (unique per clinic), roomId FK, physicalLocation, status, lastSeenAt, provisioningState, createdAt`). Migrate; keep `rooms.gatewayCode` working (readers reference a gatewayCode). `npx drizzle-kit generate` → commit SQL. **RED:** `tests/migrations/rfid-readers.test.ts` (DB-integration).
- **b) service + CRUD route** — extend `server/services/rfid-readers.service.ts` from derived-list to entity CRUD (create/rename/deactivate); new mutation endpoints behind `requireAdmin`, registered in `server/app/routes.ts`; join live heartbeat (`equipment.lastRfidGatewayCode/lastRfidSeenAt`) for status. **RED:** `tests/rfid-readers-crud.test.ts` (create/rename/deactivate; `clinicId`-scoped; cross-clinic denied).
- **c) self-serve provisioning + ingest toggle** — endpoint to provision/rotate the per-clinic HMAC secret (replaces `scripts/rfid/provision-secret.ts`) + toggle `rfid.ingest_enabled.<clinicId>` from the UI; reuse `getCredentials`/credential-manager + `server/lib/rfid/config.ts`. **RED:** `tests/rfid-provisioning.test.ts` (provision writes a secret; toggle flips the flag; admin-only).
- **d) reader-offline detection** — a scheduler/job computing staleness (no heartbeat within threshold) → emits a bounded-enum signal for the board alert (feeds R-M1.3). Register in `server/app/start-schedulers.ts`. **RED:** `tests/rfid-reader-offline.test.ts` (stale reader → offline status).
- **e) admin console CRUD UI** — turn `RfidReadersConsolePage` from read-only into CRUD (add/rename/deactivate, provision secret, ingest toggle, offline badges); reuse the console CRUD pattern from `src/pages/console/WebhooksConsolePage`/`GovernanceConsolePage`; `api.rfidReaders` gains create/update/deactivate/provision (`src/lib/api.ts`) + `src/types/`. Route stays `WebOnlyGuard + ManagementGuard`. **RED:** `tests/rfid-readers-console.test.tsx` (renders CRUD; offline badge; management-gated).
- **Guardrail:** ingest auth unchanged (reuse the webhook HMAC pattern); no custody writes.

### R-M1.2 · True directional gates (entry/exit + adjacency)
- **a) ingest schema** — extend `RfidBatchSchema` (`server/routes/rfid.ts:18-31`) with direction (`entered`|`exited`) and/or `fromGateway`/`toGateway`; keep backward-compat (direction optional → falls back to today's last-seen). **RED:** `tests/rfid-ingest-direction.test.ts` (directional payload accepted + persisted; legacy payload still works).
- **b) adjacency model** — model room/gate adjacency (which rooms a gate connects). Minimal: a gate (reader) has `fromRoomId`/`toRoomId`; `vt_equipment_rfid_reads` already has `fromRoomId`/`toRoomId` (`:164-186`) — populate them from direction instead of leaving null. **RED:** `tests/rfid-adjacency.test.ts` (directional read writes from/to rooms).
- **c) resolver uses direction** — "exited ER → entered Ward" produces last-seen = destination room; egress (exited a boundary/dock gate with no entry) flags a possible egress/theft signal (bounded enum, feeds board). **RED:** `tests/rfid-direction-resolve.test.ts`.
- **Guardrail:** additive to the existing reads table; legacy non-directional ingest must remain valid; no custody mutation.

### R-M1.3 · Command Board producer (fill the dead slot)
- **Files:** `server/services/equipment-command-board.service.ts` (no `rfid` refs today); contract `shared/equipment-board.ts:18-20,28-31,84`.
- **GREEN:** populate `unit.rfid = { lastSeenAt, readerId }`; emit `evidenceConflict` (`rfid_overrides_human_location` / `ambiguous_rfid_location`) per the R-M1.0 precedence; emit the `rfid_reader_offline` alert from R-M1.1(d). Board UI (`src/board/*`) renders the RFID chip + offline alert, respecting calm/pressure modes; `/api/display/snapshot` **stays cache-denylisted** (frozen).
- **RED:** `tests/board-rfid-surfacing.test.ts` (seeded RFID + a stale reader → snapshot carries the rfid block + offline alert; healthy clinic shows none) + `tests/board-rfid-render.test.tsx`.
- **Guardrail:** no new transport; snapshot uncached; bounded-enum only (add anomaly/conflict types to the closed enum on client + `server/routes/realtime.ts` if counters are added).

### R-M1.4 · Surface last-seen + direction in locate & detail
- **GREEN:** extend the equipment-list subtitle / `EquipmentLocationCard` to show direction ("exited ER → Ward") where available (`src/lib/equipment-rfid-display.ts`, `EquipmentLocationCard.tsx`); wire RFID last-seen into small-01 locate results + the small-02 readiness surface (read-only, per R-M1.0 precedence — never overrides an authoritative room).
- **RED:** `tests/rfid-direction-display.test.tsx` (directional read renders the arrow copy, he+en; RTL bidi-isolated room names).
- **Guardrail:** display only; freshness gate (`RFID_SUBTITLE_MAX_AGE_MS`) preserved.

### R-M1.5 · e2e golden verification (the acceptance bar)
- **e2e test** (`tests/rfid-gate-e2e.test.ts`, DB-integration + simulated payloads via the smoke path): sign a directional batch → `POST /api/rfid/events` → assert (1) resolver returns the correct destination room **and direction**, (2) it surfaces on the **board snapshot** and the equipment list, (3) an offline reader raises the board alert.
- **Golden test** (`tests/rfid-scan-only-golden.test.ts`): a clinic with `rfid.ingest_enabled=false` and no reads → board + list + resolver output **byte-for-byte identical** before/after this feature (scan-only path unaffected).
- **Negative tests:** cross-clinic reader/gateway IDs rejected (HMAC + clinic scoping); partial coverage degrades to last-known (no "unknown" regression).
- **Verify:** run the RFID suite (DB-integration runner) + `pnpm typecheck` + the Playwright board drill if board rendering changed.

---

## Definition of done (R-M1)
- M1.0–M1.5 cards RED→GREEN; `pnpm typecheck` clean; `pnpm i18n:check` green for new copy.
- The e2e golden test passes with **simulated** directional payloads (no hardware); the scan-only golden test proves zero regression.
- Reader management is fully self-serve in the console (no scripts, no manual DB edits).
- Board shows RFID last-seen + reader-offline; `/api/display/snapshot` still uncached.
- RFID still never mutates custody (assert in tests).
- Evidence logged in `docs/audit/PROOF_ALIGNMENT_LOG.md`.

## Open technical decisions (confirm at build, not blocking authoring)
- **Precedence (R-M1.0):** recommended "human-confirmed room > RFID last-seen"; confirm with eng before flipping the evidence-graph ordering.
- **Adjacency depth (R-M1.2):** minimal from/to-room per gate (recommended v1) vs a full room-adjacency graph (defer).
- **Egress/theft signal:** whether "exited a boundary gate with no re-entry" raises a board alert in v1 or is deferred to a follow-up.
