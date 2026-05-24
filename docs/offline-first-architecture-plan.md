# VetTrack offline-first architecture — signed planning document

**Status:** Approved architecture and implementation sequencing (see §13).  
**Not:** A single implementation task or one-PR deliverable.

---

## 1. Purpose and scope

### 1.1 Strategic goal

Treat offline as a **local transaction log with controlled replay**, not a cache. Every local action should eventually be: safe offline, intentionally blocked, synchronized in order, recoverable, observable, and unable to break critical clinical state.

### 1.2 Composer safety note

- Implement **one phase per PR/prompt** with explicit non-goals.
- Do not expand scope beyond that phase’s acceptance criteria.
- Phase 9 frozen surfaces remain invariant (§9).

---

## 2. Current baseline (VetTrack)

| Area | Today |
|------|--------|
| Queue | Dexie `pendingSync` in `src/lib/offline-db.ts` |
| Replay | FIFO in `src/lib/sync-engine.ts` (raw `fetch`) |
| Enqueue | `addPendingSync` from `src/lib/api.ts` only |
| Emergency | `classifyEmergencyEndpoint` in `src/lib/offline-emergency-block.ts`; no Code Blue `pendingSync` (`vt_cb_queue` removed) |
| Conflicts | 409 → in-memory `conflict-store`; statuses `pending` \| `synced` \| `failed` |
| SW | Emergency path denylist in `public/sw.js` (frozen) |

**Known gaps:** central registry, replay idempotency keys, durable conflicts/DLQ, `dependsOn` DAG (deferred), sync SLO metrics, post-sync reconciliation, batch ingest.

**Pre-existing note:** `PendingSyncType` includes `shift_session` (and `restock`) with **no** `addPendingSync` producer — address in Phase 2 per `.cursorrules` dead-code rules.

---

## 3. Policy model (target)

| `OfflinePolicy` | Meaning |
|-----------------|--------|
| `allow` | May enqueue when offline |
| `block` | Must not enqueue (Phase 2+ hard fail for unknown) |
| `draft-only` | Local draft; server reconciliation only |
| `online-required` | Not authoritative offline |

| Domain | Policy | Conflict strategy |
|--------|--------|-------------------|
| Equipment scan/checkout/return/CRUD, seen | `allow` (where wired) | Scan: append-only; checkout/return/PATCH: version-check |
| Code Blue mutations | `online-required` | N/A — blocked at enqueue |
| Medication complete, billing, dispense, authority | `online-required` | No queue |
| Unlisted | `block` (Phase 2+) | — |

**Deferred:** `dependsOn` DAG — use FIFO, checkout/return dedup, server 409 until proven insufficient.

---

## 4. Risk assessment

| Risk | Mitigation |
|------|------------|
| Big-bang PR | Phased delivery; Phase 1 behavior-neutral |
| Code Blue queued offline | `classifyEmergencyEndpoint` only for reject; frozen tests |
| Double-apply on replay | Phase 4; document gap until then |
| Unknown silent enqueue | Phase 1 warn; Phase 2 hard fail |
| Operator trusts optimistic UI | Phase 6; interim risk documented |

---

## 5. Phase order

### Phase 1 — Client policy registry and audit gate

**Files:** `src/lib/offline-policy.ts`, `src/lib/offline-mutation-registry.ts` (client-local; not `shared/` until later).

**Registry:** Map all **production enqueue producers**; document `online-required` domains for audit.

**Gate (before enqueue):**

| Condition | Behavior |
|-----------|----------|
| `classifyEmergencyEndpoint(url, method)` matches | **Reject enqueue** (existing mechanism) |
| Registry `allow` for this producer | Enqueue **unchanged** |
| Registry `online-required` (non-emergency) | **Documentation only** — no new reject |
| Unknown | **Warn**, still enqueue |

**Out of scope:** Dexie migration; idempotency fields; server; `sync-engine` replay changes; UI; SW; `POST /api/sync/mutations`; hard-block unknown; metrics; drills; reconciliation.

**Acceptance criteria:**

1. **100% of production enqueue producers reachable through `addPendingSync` must resolve to a registry entry during tests** (behavioral coverage, not a brittle “grep every call site” rule).
2. Code Blue emergency paths cannot enqueue offline via **`classifyEmergencyEndpoint` only**; emergency tests pass unchanged.
3. Registered equipment producers behave identically to pre-Phase 1 (same Dexie rows, same replay).
4. Unregistered enqueue emits structured warn; enqueue still succeeds.
5. Tests assert `online-required` registry entries have **no** enqueue producer unless explicitly listed.
6. `npx tsc --noEmit`; no `server/`, `public/sw.js`, sync-engine replay, UI, or locale changes.
7. PR names phase and lists non-goals.

---

### Phase 2 — Registry hardening (client-only)

- Unknown enqueue: warn → **hard fail**.
- Remove or wire orphan `PendingSyncType` values (`shift_session`, `restock`, etc.).
- Optional `shared/` move only with server/CI consumer in same PR.

---

### Phase 3 — Dexie queue extension

- New schema version: `clientMutationId`, `idempotencyKey`, `clinicId`, `userId`, `schemaVersion`, `updatedAt`, errors.
- FIFO replay unchanged; no `dependsOn`.

---

### Phase 4 — Replay idempotency (equipment)

- Client: `Idempotency-Key` (and client mutation id) on replay.
- **Server: idempotent replay support for checkout/return and other mutable equipment actions.**
- **Scan events remain append-only audit events:** replay protection should prevent accidental transport duplicates **without** collapsing legitimate repeated scans.

---

### Phase 5 — State machine and durable conflicts

- `pending` → `processing` → `synced`; `failed` → `dead`; `conflict` for 409.
- Persist conflicts in Dexie; revise silent purge policy.

---

### Phase 6 — Operator UX and DLQ

- `LocalEntityState` on equipment; honest pending copy; sync sheet dead section; i18n en/he.

---

### Phase 7 — Emergency surfaces CI gate

- Canonical path list (classifier + SW bypass); CI fails on unclassified new routes. Do not change SW caching behavior.

---

### Phase 8 — Observability

- Bounded metrics including **`oldest_pending_sync_age_seconds`**; client throttled reporter.

---

### Phase 9 — Reconnect reconciliation

- After queue idle: authoritative fetch → repair Dexie → invalidate queries; use existing ward/display resync hooks; no new polling transport.

---

### Phase 10 — Playwright offline drills

- Reload survival, mid-sync drop, 409 conflict, Code Blue block with empty queue.

---

### Phase 11 — Optional batch ingestion

- `POST /api/sync/mutations` behind flag; only after Phase 4 proven on equipment.

---

### Backlog

- `dependsOn` DAG (deferred)
- Inventory `draft-only` reconciliation
- Medication offline: **out of scope** — remain online-required

---

## 6. Non-goals (global)

- Full plan in **one PR**.
- Offline queue for Code Blue mutations.
- SW cache of emergency/live API paths.
- WebSocket replacement for SSE/outbox.
- Weakening Phase 9 emergency/offline tests.
- Dexie as authoritative truth without server reconciliation (until Phase 9).
- Generic clinical merge conflict resolver.
- `dependsOn` in Phases 1–4.
- **Phase 1: do not reject non-emergency `online-required` registry entries. Only `classifyEmergencyEndpoint` continues to reject enqueue behavior.**
- Phase 1: `shared/` policy module, server changes, UI, SW, sync-engine replay changes.

---

## 7. Phase 9 frozen surfaces

| Surface | Rule |
|---------|------|
| Code Blue mutations | Never `pendingSync`; `classifyEmergencyEndpoint` + loud UX |
| Service worker | Never cache emergency/live denylist paths |
| Realtime | SSE + outbox only |
| Telemetry | Bounded enums only |
| Emergency buffer | sessionStorage; never posted as mutations |

---

## 8. PR checklist (offline-touching)

1. Single phase only.  
2. Registry / policy appropriate for phase.  
3. Code Blue still cannot enqueue.  
4. Frozen surfaces untouched.  
5. Tests match phase acceptance criteria.  
6. Non-goals in PR body.

---

## 9. First Composer prompt outline (Phase 1)

**Must do:** Policy files; gate on enqueue path; behavioral test that every producer through `addPendingSync` resolves to registry; emergency via classifier only.

**Non-goals:** Dexie bump, sync-engine, server, UI, SW, hard-block unknown, idempotency, DAG, batch ingest, reject non-emergency `online-required`.

**Verify:** `npx tsc --noEmit`; `pnpm test` including `tests/offline-emergency-block.test.ts`.

---

## 10. Bottom line

North star: policy + idempotency + conflicts + observability + reconciliation. **Ship Phase 1 first** with zero user-visible behavior change except dev warnings, while every enqueue producer is explicit and emergencies stay impossible to queue.

---

## 11. Sign-off decision

**Approved** as architecture and implementation sequencing document.

**Approval conditions:**

- No phase may expand scope beyond its listed acceptance criteria.
- Composer implementation prompts must target **one phase only**.
- Phase 9 frozen surfaces remain invariant.
- Any cross-cutting refactor requires a **separate architecture review**.
