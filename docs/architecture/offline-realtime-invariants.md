# Offline & realtime invariants (frozen)

**Do not change casually.** Full doctrine: `CLAUDE.md` → Frozen architecture surfaces.

## Realtime

| Invariant | Detail |
|-----------|--------|
| Transport | SSE `GET /api/realtime/stream` — not WebSockets, not client polling of `vt_event_outbox` |
| Ordering | Monotonic outbox cursor (`id:`); replay via `Last-Event-ID` / `GET /api/realtime/replay` |
| Publisher | Single loop in `server/lib/event-publisher.ts` (`POLL_MS = 750`) — no second publisher |
| Domain writes | `insertRealtimeDomainEvent(tx, …)` in **same transaction** as state change when loss on rollback is unacceptable |
| Consumers | Subscribe to `outboxEmitter` only |
| KEEPALIVE | ~10s; does not invalidate query caches |
| Telemetry | Bounded enums via `POST /api/realtime/telemetry` — no PII, free-form labels, or raw timestamps |

## Code Blue / emergency

| Invariant | Detail |
|-----------|--------|
| Offline | Emergency mutations **never** queued — `classifyEmergencyEndpoint()` in `src/lib/offline-emergency-block.ts` |
| Session end | Server-confirmed only — no optimistic local termination |
| Recovery | Replay + snapshot reconciliation — no polling fallback for emergency state |
| SW cache | `/api/code-blue/*`, `/api/display/snapshot`, `/api/realtime/*` — **never** in Cache Storage |

## Offline sync

| Invariant | Detail |
|-----------|--------|
| API entry | All browser API traffic through `src/lib/api.ts` `request()` |
| Queue | `addPendingSync` on network failure when `offline` options set — never drop silently |
| Engine | `sync-engine.ts`: `MAX_RETRIES = 5`, circuit breaker, `ITEM_TIMEOUT_MS = 30_000` |
| Dexie | Schema versions in `offline-db.ts` — coordinate `PendingSyncType` with processors |
| Types | `scan`, `seen`, `create`, `update`, `delete`, `checkout`, `return`, `return_with_charge` |

## PWA / build tag

- `__VT_BUILD_TAG__` — single source for SW cache name and split-version detection
- `BroadcastChannel` envelope: cursor, buildTag, ts, senderNonce
- Global chunk recovery in `main.tsx` only — no per-page duplicate handlers

## Authority (clinical)

- Evaluators: `off | shadow | enforce` per clinic
- Strategy A safety net: legacy shift-derived path unchanged for clinics without open check-in
- Resolver throw at wiring → degrade to `off` (CI-16/CI-20)

## Modularization impact

Refactors may **move** realtime/offline code but must not:

- Rename outbox event types or queue names/job payloads
- Add emergency endpoints to any cache path
- Introduce parallel realtime transport
- Alter TanStack invalidation tied to SSE without explicit verification

Tests: `tests/phase-9-deterministic-drills.test.ts`; browser harness `tests/phase-9-drills.spec.ts` when touching these paths.
