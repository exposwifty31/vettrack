# Frozen Surface Change Protocol

Any change that touches one of the surfaces listed below requires completing this checklist **before** merge. These surfaces are frozen because breaking them silently causes data loss, security regressions, or loss of emergency-care availability — categories where a failing test is preferable to a working-but-wrong deploy.

Cross-reference: [`CLAUDE.md` §Frozen architecture surfaces](../../CLAUDE.md) · [`CLAUDE.md` §Operational doctrine](../../CLAUDE.md)

---

## 1. Frozen Surfaces and Why They Are Frozen

### 1.1 SSE / Outbox Transport

**Files:** `server/routes/realtime.ts`, `server/lib/event-publisher.ts`, `server/lib/realtime-outbox.ts`

The realtime pipeline is a single SSE connection per clinic backed by a monotonic `vt_event_outbox` cursor. The cursor ordering, `Last-Event-ID` resume, replay path, and `reset_state:last_event_pruned` fallback form a closed contract with every browser tab and the service worker. Swapping the transport (e.g., WebSockets) or introducing a second publisher loop breaks cursor ordering, causes duplicate or missing domain events, and can leave ward boards and Code Blue displays in a permanently stale state with no recovery path.

The `outboxEmitter` is the **only** fan-out mechanism. Consumers that bypass it and poll `vt_event_outbox` directly create a second publish ordering, which is forbidden.

### 1.2 PWA Service Worker & Build-Tag Mechanism

**Files:** `public/sw.js`, anywhere that sets `__VT_BUILD_TAG__`

The build tag is the single source of truth for the SW cache name (`vettrack-<buildTag>`), split-version detection via `BroadcastChannel`, and forced-reload logic in `main.tsx`. Altering how `BUILD_TAG` is injected, how old caches are pruned on `activate`, or how `skipWaiting` is called breaks the deploy-rollout model: stale SWs serve a mix of old and new assets, and the split-version detection fires falsely or not at all.

### 1.3 Code Blue Online-Only Path

**Files:** `server/routes/code-blue.ts`, `src/lib/offline-emergency-block.ts`, `shared/emergency-surfaces.manifest.ts`

Code Blue mutations (`POST /sessions`, `POST /:id/logs`, `PATCH /:id/end`, `PATCH /:id/presence`) must never be queued for offline replay. `classifyEmergencyEndpoint()` intercepts them in the API client and blocks the queue path. Weakening this block — by removing an endpoint from `EMERGENCY_OFFLINE_BLOCK_MUTATIONS`, by allowing offline queuing, or by optimistically marking a session ended without server confirmation — risks replaying emergency clinical actions out of order after reconnection.

Session end is **server-confirmed**. The UI never optimistically terminates a session.

### 1.4 Authority Evaluators

**Files:** `server/lib/authority/enforcement/*`

Each evaluator family (`stale`, `oprole`, `task-assignment`, `stale-task-ownership`, `code-blue-manager`, `clinical-invariant`) operates under a per-clinic `off | shadow | enforce` mode resolved at request time. The three-way envelope, the Strategy A safety-net fallback (unchanged legacy shift-derived path for clinics without an open `vt_clinical_check_ins` row), and the wiring-layer fail-open on resolver throw (CI-16/CI-20) are all load-bearing contracts. Removing Strategy A, changing `off` to issue DB queries, or making `enforce` non-atomic with the domain write breaks clinical access control semantics.

### 1.5 Emergency Endpoint Cache Denylist

**Files:** `public/sw.js` (lines 38–67), `server/routes/realtime.ts`

The following endpoints are unconditionally bypassed by the service worker — they are never read from or written to Cache Storage, and any pre-existing cached entries are purged on SW `activate`:

- `/api/display/snapshot`
- `/api/code-blue/sessions/active`
- `/api/realtime/stream`
- `/api/realtime/replay`
- `/api/realtime/outbox-head`
- `/api/realtime/telemetry`

Adding an emergency or realtime endpoint to any cache path allows stale emergency state to be served to kiosk displays and ward boards, which is a patient-safety regression.

---

## 2. Pre-Merge Checklist

Complete **all** items for every surface you touch. Items marked ✳ apply to all frozen-surface changes regardless of which surface.

### ✳ Universal (all frozen surfaces)

- [ ] `npx tsc --noEmit` — zero errors (frontend)
- [ ] `npx tsc --noEmit --project tsconfig.server-check.json` — zero errors (server)
- [ ] `pnpm test` — all default vitest suites pass
- [ ] `bash scripts/ci/contracts-gate.sh` — `@vettrack/contracts` + emergency parity pass
- [ ] Diff reviewed against `CLAUDE.md` §Operational doctrine — no forbidden patterns introduced

### 2.1 SSE / Outbox Transport

- [ ] Phase 9 deterministic drills pass: `pnpm vitest run tests/phase-9-deterministic-drills.test.ts`
- [ ] Playwright browser harness passes: `pnpm test:playwright:ci` with `PW_SUITE=phase9`
- [ ] No second publisher loop introduced — only one `startEventOutboxPublisher()` call exists in `server/app/start-schedulers.ts`
- [ ] All outbox consumers subscribe via `outboxEmitter` — no direct polling of `vt_event_outbox` from feature code
- [ ] Cursor ordering verified: `id:` SSE field sourced from `vt_event_outbox.id` (monotonic integer)
- [ ] `Last-Event-ID` resume path still reaches `replayPublishedOutboxAfter` and emits `reset_state:last_event_pruned` on pruned cursor

### 2.2 PWA Service Worker & Build-Tag

- [ ] `__VT_BUILD_TAG__` injection verified in both `public/sw.js` and the client bundle (single source)
- [ ] SW `activate` still purges all `vettrack-*` caches that do not match `CACHE_NAME`
- [ ] `skipWaiting()` called in `install` handler — no conditional skip
- [ ] `SW_UPDATED { buildTag }` posted to all clients after `activate`
- [ ] `BroadcastChannel("vt_realtime_outbox_cursor")` envelope still carries `buildTag`, `cursor`, `ts`, `senderNonce`, `kind`
- [ ] Split-version detection in `main.tsx` still fires on peer-tab tag divergence
- [ ] Playwright phase-9 drills: verify SW cache purge and reload-once guard (`sessionStorage` loop guard)

### 2.3 Code Blue Online-Only Path

- [ ] `shared/emergency-surfaces.manifest.ts` still lists all mutation endpoints in `EMERGENCY_OFFLINE_BLOCK_MUTATIONS`
- [ ] `classifyEmergencyEndpoint()` test coverage passes: `tests/code-blue-mode-equipment.test.js`
- [ ] No mutation endpoint removed from `EMERGENCY_OFFLINE_BLOCK_MUTATIONS` without Product + Engineering sign-off
- [ ] `addPendingSync` is **not** called from any Code Blue mutation path — grep: `rg "addPendingSync" server/routes/code-blue.ts` returns zero hits
- [ ] Session-end UI verified: status change driven by SSE event or keepalive reconciliation — no optimistic local update
- [ ] Loud offline toast still fires when mutation is blocked (counter `offline_emergency_mutation_blocked_*`)

### 2.4 Authority Evaluators

- [ ] No evaluator removed from `server/lib/authority/enforcement/`
- [ ] `off | shadow | enforce` mode path preserved in every evaluator (`if (mode === "off") return { action: "allow" }` must be first branch)
- [ ] Strategy A fallback (shift-derived authority) untouched in `server/lib/authority.ts`
- [ ] Wiring-layer resolver-throw → `off` fallback preserved (CI-16/CI-20 invariant)
- [ ] `SMART_COP_VALIDATION_FAIL_OPEN` still defaults to `false` in production config (`CONTRIBUTING.md` §SE-07)
- [ ] Shadow-mode sampled log line still present in `stale.evaluator.ts` (no silent shadow removes observability)
- [ ] `tests/authority-enforcement-import-isolation.test.ts` passes (no cross-evaluator imports)
- [ ] Any new `enforce`-mode deny path uses an atomic `db.transaction` — deny never races with the domain write

### 2.5 Emergency Endpoint Cache Denylist

- [ ] Denylist in `public/sw.js` (const `EMERGENCY_BYPASS_PATHS`) still includes all six paths listed in §1.5
- [ ] `isEmergencyBypass()` predicate (or equivalent) is called in the `fetch` handler **before** any cache read
- [ ] SW `activate` purges pre-existing cached entries for denylist paths
- [ ] No new Code Blue, snapshot, or realtime URL added to any `caches.open(...).then(cache => cache.put(...))` branch

---

## 3. Exception Approval

If a change must modify a frozen surface by design (e.g., adding a new realtime event type, extending the Code Blue manifest), obtain approval **before** opening the PR:

| Approver | Scope |
|---|---|
| Repository owner (`@dboy31561`) | Any frozen surface |
| Second engineer (on-call or designated lead) | SSE/outbox or Code Blue path |
| Written rationale in PR description | All exceptions |

Document the exception in the PR description using the template in §5. If the change is additive (e.g., new outbox event type, new telemetry counter) and does not alter existing cursor ordering or transport semantics, it is **lower risk** — still complete the checklist but exception approval may be informal (comment on the PR).

Forbidden exceptions regardless of approval:
- Swapping SSE transport for WebSockets or long-polling
- Adding any emergency mutation to the offline sync queue
- Removing Strategy A from the authority resolver
- Adding a Code Blue or realtime endpoint to Cache Storage

---

## 4. Reference

- [`CLAUDE.md` §Frozen architecture surfaces](../../CLAUDE.md) — authoritative invariant list
- [`CLAUDE.md` §Operational doctrine (what NOT to do)](../../CLAUDE.md)
- [`tests/phase-9-deterministic-drills.test.ts`](../../tests/phase-9-deterministic-drills.test.ts) — bounded-counter contracts
- [`tests/phase-9-drills.spec.ts`](../../tests/phase-9-drills.spec.ts) — Playwright browser harness for realtime/PWA drills
- [`server/lib/authority/enforcement/`](../../server/lib/authority/enforcement/) — evaluator family implementations
- [`shared/emergency-surfaces.manifest.ts`](../../shared/emergency-surfaces.manifest.ts) — Code Blue endpoint manifest

---

## 5. PR Description Template (Frozen-Surface Changes)

```markdown
## Frozen Surface Change

**Surface(s) touched:** <!-- SSE/Outbox | PWA/SW | Code Blue | Authority Evaluators | Cache Denylist -->

**Reason this surface must change:**
<!-- One paragraph — what cannot be achieved without touching this surface -->

**Safety argument:**
<!-- Why the invariant is preserved despite the change — e.g. "cursor ordering is unaffected because..." -->

**Exception approval:**
<!-- Link to comment or approval from @dboy31561 or designated lead -->

## Checklist

- [ ] Universal items from FROZEN_SURFACE_CHANGE_PROTOCOL.md §2 completed
- [ ] Surface-specific items from §2.x completed
- [ ] `pnpm vitest run tests/phase-9-deterministic-drills.test.ts` passed
- [ ] Playwright phase-9 drills passed
- [ ] No forbidden patterns from CLAUDE.md §Operational doctrine introduced
```
