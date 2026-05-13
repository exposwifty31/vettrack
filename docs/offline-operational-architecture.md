# VetTrack Offline Operational Architecture

**Status:** Phase 0 alignment document — **final pre-freeze pass**.
**Source:** `docs/authority-model.md`, `docs/operational-modes.md`, `docs/task-product-model.md`, `docs/ownership-lifecycle.md`, `docs/phase-2.5-decision-brief.md`.
**Audience:** Engineers planning Phase 2.5+; FE / sync-engine maintainers; clinical-workflow reviewers.

This document defines V1 operational behaviour under degraded connectivity. V1 is **online-first, offline-tolerant** — not offline-first. Backend is authoritative on reconcile. **No CRDTs, no event sourcing, no peer-to-peer, no distributed sync infrastructure.**

---

## 1. Core philosophy

Five principles. All other rules in this document derive from these.

1. **Backend is authoritative.** Every mutation is re-validated by the server on reconcile. The client never makes a final decision about clinical authority or workflow state.
2. **Safe degradation, not optimistic merging.** Conflicts surface; they are never silently resolved client-side.
3. **Cache for reads; queue for safe writes; fail closed for safety-critical actions.** Three lanes per workflow.
4. **No silent failures.** Every queued mutation that fails on reconcile produces a user-visible error with a structured reason.
5. **Use existing infrastructure.** `src/lib/offline-db.ts` (Dexie) for local persistence and `src/lib/sync-engine.ts` (FIFO + retries + circuit-breaker) for mutation queueing already exist. **No new sync infrastructure is introduced in V1.**

---

## 2. Authority caching rules

The FE caches authority state for UX gating only. The server NEVER trusts cached authority.

- **Cache window:** **60 seconds** since last `/api/users/me` fetch. **APPROVED (PDN-O1 RESOLVED).** Server remains authoritative. First 401/403 response invalidates the cache immediately.
- **Cached fields:** `systemRole`, `clinicalRole`, `activeShiftRole`, `operationalRole`, the user's `allowedOperationalRoles`, the clinic's effective `clinicPolicy`.
- **NOT cached:** mid-session shift-end events from other tabs / browsers / devices. Detected only on reconnect.
- **Invalidation:** any 401 / 403 response invalidates the cache immediately. Manual refresh button forces refetch.
- **Use:** FE button enable/disable and modal trigger only. **The cache is never proof of authority for the backend.**

---

## 3. Per-workflow offline support

For each workflow:

- **Offline permitted?** — yes / no / partial (with explicit precondition).
- **Live authority required?** — at endpoint time.
- **Queue allowed?** — yes / no.
- **Fail closed when stale?** — server-side enforcement on reconcile.
- **Reconcile strategy.**

### 3.1 Task completion (non-medication)

- **Offline permitted:** YES if the task is cached locally.
- **Live authority required:** at action time, no (cached active-shift state); at reconcile time, yes.
- **Queue:** YES with idempotency key.
- **Fail closed when stale:** server-side. If user's shift ended during the queued window, server rejects with `STALE_AUTHORITY`; FE shows "Your shift ended during this action."
- **Reconcile:** server validates current authority + applies idempotency.

### 3.2 Medication workflows

| Sub-action | Offline | Notes |
|---|---|---|
| Create medication task | **NO** | Vet operational-role-only; fail closed. |
| Vet approve | **NO** | Live Vet authority required. |
| Start medication task | partial | Permitted only if the vet-approval state is cached and the user has cached acknowledgement authority. Queue the start mutation. |
| Volume / dose calculation | YES (local) | No server commit during calculation. |
| Complete medication task | partial | Permitted only if `acknowledgedBy` is cached. Queue with idempotency key. Server re-validates `acknowledgedBy` match + active-shift Tech / Vet. |
| Report medication issue | YES | Queued; server notifies creating Vet on reconcile. |
| Dose change by Tech | **NEVER** | Hard rule — even online. |

The **inventory deduction job** is created server-side after complete reconciles; offline does not block billing or audit, but inventory deduction is delayed (existing Phase 1 PR 1.3 recovery scheduler picks up the backlog).

### 3.3 Code Blue workflows

| Sub-action | Offline | Notes |
|---|---|---|
| Trigger Code Blue | YES | Idempotent create; server creates session. |
| Add log entry | YES | High-frequency during active session; queue batched. Idempotency key per entry. **PDN-O4 RESOLVED — replay failures must NEVER be silently dropped; surface to incident review / unresolved sync queue.** |
| Presence heartbeat | YES, best-effort | Lost heartbeats are accepted; server uses 30s stale window. |
| Assign / reassign manager | **NO** | Live authority required. |
| End Code Blue session | **NO — STRICT** | Live authority required. Fail closed. |
| Early closure (<15min) | **NO** | Live authority required + structured reason. |

**Manager disconnect during active session:** Phase 2.5 Decision 4 BLOCKS manager check-out when a Code Blue is active, so the manager cannot voluntarily depart. Involuntary disconnect (network loss) preserves ownership; reconcile re-validates authority for end-session.

### 3.4 Inventory workflows

| Sub-action | Offline | Notes |
|---|---|---|
| Restock session start | YES | Queued. |
| Restock scan (`observedQuantity`) | YES | Queued; server computes delta. |
| Restock finish | YES | Queued. |
| Dispense (non-emergency) | **NO** | Medication safety; live authority required. |
| Dispense (emergency) | YES | Clinical override; server reconciles after. **PDN-O3 RESOLVED — no post-reconnect attestation required in V1.** |
| Blind audit | YES | Queued. |
| Container CRUD | **NO** | Admin-only; live authority required. |

### 3.5 Check-in / check-out

| Sub-action | Offline | Notes |
|---|---|---|
| Check-in (Vet or Tech) | **NO** | Live authority establishment. Fail closed with "Connect to check in" message. |
| Check-out (manual) | YES if session is cached | Queued; server records end time. Code Blue manager check-out is BLOCKED (Phase 2.5 Decision 4). |
| Auto check-out at block end | server-side | No client involvement. |
| Refresh authority (`/me`) | **NO** | Required online; failure surfaces "Reconnect to refresh your shift." |

### 3.6 ER Mode toggle

| Sub-action | Offline | Notes |
|---|---|---|
| Enable | **NO** | Global flag; live Senior Vet authority required. |
| Disable (Senior Vet path) | **NO** | Live authority. |
| Disable (Admin escape hatch) | **NO** | Live Admin required. Decision 5 of Phase 2.5 brief. |

### 3.7 Notifications

| Sub-action | Offline | Notes |
|---|---|---|
| Receive push | server-managed | Delivered when reconnected via existing push-subscription model. |
| Ack notification | YES | Queued. |
| Send in-app notification | YES (local) | Synthesised client-side from queued events; not authoritative. |

### 3.8 Audit logging

**ALL audit entries are written server-side.** Client never generates audit records. Client mutations carry `originalClientTimestamp`; server writes audit with both client and server times.

### 3.9 Equipment workflows

| Sub-action | Offline | Notes |
|---|---|---|
| Scan equipment | YES | Queued. |
| Check out equipment | YES | Queued; conflict UX on reconcile if already checked out. |
| Return equipment | YES | Queued; server validates ownership (Phase 2B.3). |
| Bulk move / verify | YES | Queued. |
| Bulk delete / restore | **NO** | Admin-only. |

### 3.10 Escalation workflows

| Sub-action | Offline | Notes |
|---|---|---|
| Manual escalate (Phase 3B) | YES | Queued. |
| Accept escalated task | YES | First-write-wins via server conditional update; later accepts return 409. |
| Refuse escalated task | YES | Queued; audit-logged. |
| Scheduler-driven escalation (Phase 3C) | server-side | No client involvement. |

---

## 4. Local persistence rules

Reuses existing `src/lib/offline-db.ts` (Dexie). No new persistence infrastructure.

**Existing stores:**

- `equipment` — read cache.
- `rooms` — read cache.
- `sync-queue` — pending mutations.

**Phase 2.5 additions (small extensions to existing Dexie schema, no new infra):**

- `current-session` — the user's current check-in session (if any).
- `clinic-policy` — cached effective clinic policy (TTL-bound).
- `eligible-assignees-cache` — per-task-type cached eligibility lists (TTL-bound; for offline task-creation).

**Out of scope:** SQLite, LiteFS, IPFS, OPFS, any peer-to-peer storage. **Not introducing new client persistence stacks.**

---

## 5. Mutation queue mechanics

Reuses existing `src/lib/sync-engine.ts`. No new queue infrastructure.

**Existing behaviour (preserved):**

- FIFO order per resource type.
- Exponential backoff retries.
- Circuit-breaker on sustained server failures.
- Sentry capture on permanent failures.

**Phase 2.5 additions (small payload extensions):**

Every queued mutation carries:

```
{
  idempotencyKey: string,         // existing pattern; per Phase 1 PR 1.2
  originalClientTimestamp: ISO,   // when the user took the action
  cachedAuthoritySnapshot?: {     // diagnostics only; never trusted by server
    systemRole, clinicalRole, activeShiftRole, operationalRole
  },
  payload: ...                    // existing
}
```

**The server NEVER trusts `cachedAuthoritySnapshot`.** It is logged for replay analysis and incident review only.

---

## 6. Reconnect reconciliation

On reconnect:

1. FE issues `GET /api/users/me` to refresh authority cache.
2. If `/me` indicates session ended (auto-check-out), FE invalidates local session state and surfaces "Your shift ended — please re-check-in."
3. Sync-engine drains the queue in FIFO order.
4. Each mutation is sent with its `idempotencyKey`. Server validates current authority and applies idempotency.
5. Server response categorises into one of:
   - `SUCCESS` — mutation applied or replayed.
   - `IDEMPOTENT_ALREADY_APPLIED` — prior reconcile completed this; FE removes from queue silently.
   - `STALE_AUTHORITY` — user's shift / operational role at server-time does not permit; FE surfaces structured error.
   - `CONFLICT` — workflow state changed (e.g., equipment now checked out elsewhere); FE shows conflict UX.
   - `INVALID_PAYLOAD` — schema/version mismatch; FE surfaces error.
6. Successful and idempotent mutations clear from the queue.
7. Failed mutations remain in the queue with a structured failure reason; FE shows retry / discard per mutation.

**Hard rule: no silent drops.** Every failed mutation produces a user-visible signal.

---

## 7. Idempotency requirements

- Every state-changing endpoint requires an `idempotencyKey` header (existing `server/middleware/idempotency.ts`).
- Server stores `key → result` for a TTL (existing).
- Replays return the cached result without re-executing the handler.
- **Audit fires only on first execution.** Replays do not re-audit (existing behaviour; called out here for offline context).
- For high-frequency endpoints (Code Blue log entries, equipment scans), keys are per-mutation, not per-session.

---

## 8. Conflict handling

Five conflict types. No client-side merging of clinical data.

| Conflict | Example | Resolution |
|---|---|---|
| **STALE_AUTHORITY** | User's shift ended between queue and reconcile | Server rejects with reason. FE shows "shift ended during action" with explicit retry / discard / handoff options. |
| **CONFLICT** (state divergence) | Equipment already checked out to someone else when reconcile arrives | Server returns current owner; FE shows "Equipment is held by [user]. Take action: Request return / Discard your action." |
| **ALREADY_APPLIED** | Task already completed by another user | Server returns idempotent success; FE marks as completed silently. |
| **STATE_MISMATCH** | Code Blue session already ended | Server rejects; FE shows "Session ended at [time]. Your log entries: discard / file as incident." |
| **INVALID_PAYLOAD** | Schema version drift (post-deploy) | Server rejects; FE shows "Update available — please refresh." |

**Never** merge clinical fields (dosages, billing, audit) automatically. **Always** surface the conflict to the user.

---

## 9. Audit reconstruction

- All audit entries server-written.
- Client mutations carry `originalClientTimestamp`; audit records both `originalClientTimestamp` and `serverReceivedAt`.
- Code Blue specifically: elapsed time in a session uses the **earliest queued client timestamp** for any log entry to preserve clinical event ordering.
- Audit log queries can present either client time (clinical reality) or server time (system reality); UI defaults to client time.

---

## 10. Notification failure behaviour

- Push delivery is best-effort. Missed push notifications during offline are delivered on reconnect via the existing push-subscription replay.
- In-app notifications synthesised client-side from queued events are advisory; the server's notification record is authoritative.
- Notification ack is queued; never critical-path.

---

## 11. Degraded-state UX

Reuses existing surfaces:

- Header banner from `<UpdateBanner>` / sync indicators.
- Per-action: disabled buttons with tooltip explaining "Requires connectivity" for offline-prohibited actions.
- Per-mutation: queued indicator (existing sync-engine state).
- Per-failure: explicit error banner with retry / discard.

**No silent disable.** Every disabled action shows the user *why*.

**No spinner-of-doom.** A queued action shows "Queued — will sync when online," not a perpetual spinner.

---

## 12. Silent-failure prohibitions

Explicit list of behaviours that are FORBIDDEN in V1:

- **Dropping a queued mutation without user signal.** Always show.
- **Auto-merging clinical data after a conflict.** Surface the conflict.
- **Hiding "you have N pending mutations" from the user.** Always visible in header.
- **Failing a queued mutation without categorised reason.** Server must return a structured reject reason; FE must display it.
- **Retry-loop without backoff or cap.** Existing sync-engine handles this; do not bypass.

---

## 13. Sync recovery

- Manual "retry" button drains the queue once.
- Manual "discard" per mutation drops it; server records `mutation.discarded` audit when the FE is next online.
- On app restart: queue persists in Dexie; first reconnect drains it.
- Sustained server failures trip the circuit-breaker (existing); user sees "Connection unstable — pausing sync." UI offers force-resume.

---

## 14. Open product decisions

**Resolved (architecture freeze sign-offs):**

- **PDN-O1 — RESOLVED.** Authority cache TTL = **60 seconds**. Server remains authoritative. First 401/403 invalidates cache immediately.
- **PDN-O3 — RESOLVED.** **No emergency-dispense attestation in V1.** Reconcile applies the queued dispense without a post-reconnect attestation step.
- **PDN-O4 — RESOLVED.** **Code Blue replay failures must NEVER be silently dropped.** Failed replays surface to incident review / unresolved sync queue and remain user-visible until resolved or explicitly discarded.

**Still open (deferrable, do not block Phase 1):**

- **PDN-O2** Maximum queue depth before forcing reconnect (no V1 limit proposed; revisit if load testing reveals a problem).
- **PDN-O5** Equipment-checkout conflict UX wording.
- **PDN-O6** Whether to expire offline-cached `eligible-assignees` aggressively (60s? per-session?) to avoid stale-list 403s.
- **PDN-O7** Mid-session shift-end propagation across tabs (deferred to Phase 5; see §16).

---

## 15. Non-goals

- **Not offline-first.** V1 is online-first; offline is a degraded mode.
- **No CRDTs.**
- **No event sourcing.**
- **No distributed sync / peer-to-peer.**
- **No client-side audit generation.**
- **No optimistic merge of clinical data.**
- **No SQLite, LiteFS, IPFS.**
- **No native-mobile assumptions.**
- **No new sync infrastructure beyond extensions of `offline-db.ts` and `sync-engine.ts`.**

---

## 16. What V1 explicitly defers

- Mid-session shift-end propagation across tabs (PDN-O7 implicit): if a user checks out in tab A, tab B still believes it has authority until the cache TTL expires or a 401/403 is observed. V1 accepts this; Phase 5 may add BroadcastChannel-based sync.
- Multi-device handoff (the same user logged in on phone + laptop). V1 caches per-device; no shared sync.
- Offline forecasting / planning workflows beyond what already exists.
- Native mobile offline-first app (not in scope).
