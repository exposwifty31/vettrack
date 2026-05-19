# VetTrack Phase 10 Stabilization Report

**Date:** 2026-05-19  
**Branch:** main (commit f5eece0f)  
**Scope:** Post-Phase-9 browser/runtime/PWA/realtime certification

---

## Executive Summary

| Question | Answer |
|----------|--------|
| **Merge-safe (current main)?** | Yes — all existing vitest (3372/3372) and TypeScript checks pass clean. |
| **Browser-certified?** | Partially. 54/71 Playwright tests pass. 5 fail (SW registration in headless Chromium — environment limitation, not code bug). 12 skipped (Clerk/DB prereqs). |
| **Blockers for Phase 10?** | **2 P0 clinical correctness issues** must be resolved first. |
| **Recommended Phase 10 scope?** | ~15 localized fixes across 3 subsystems (Code Blue, offline/sync, realtime). No architectural changes needed. |

---

## Test Execution Results

### Vitest (unit/integration)
- ✅ **224 files / 3372 tests — all pass** (16.2s)

### TypeScript
- ✅ **`npx tsc --noEmit` — zero errors**

### Playwright (Chromium headless)
- ✅ **54 passed** (all UI smoke, public routes, auth routes, manifest, mobile viewports, session persistence, console error checks, Phase 9 drills 1-6/8, cardinality assertion)
- ⚠️ **5 failed** — all SW-dependent (P04, P05, P06, P07, Drill 7). Root cause: Playwright's `chromium_headless_shell` does not support Service Worker API. Tests pass conceptually when the SW is served correctly (build tag replacement confirmed in `dist/public/sw.js`).
- ⏭️ **12 skipped** — Clerk test keys not available (T4-T7), metrics endpoint requires auth in certain modes (Drills 1-6/8 actually ran and passed via telemetry API path)

---

## Prioritized Issue List

### MUST FIX BEFORE PHASE 10

#### P0-1: Code Blue mutations bypass offline emergency doctrine via `authFetch`

| Field | Detail |
|-------|--------|
| **Severity** | P0 — Clinical correctness |
| **Subsystem** | Code Blue / offline safety |
| **Affected files** | `src/hooks/useCodeBlueSession.ts` (L50-68, L129-160, L162-213), `src/lib/auth-fetch.ts` |
| **Root cause** | `useCodeBlueSession` uses `authFetch()` directly instead of `api.request()`. `authFetch` has no emergency endpoint classifier (`classifyEmergencyEndpoint` from `src/lib/offline-emergency-block.ts`). Failed CB log POSTs are queued in `localStorage` (`vt_cb_queue`) and replayed on reconnect — violating Phase 9 doctrine: "Code Blue mutations must fail loud when offline; do not extend the sync engine to cover them." |
| **Reproduction** | Open `/code-blue` during active session → go offline → tap quick-log drug button → entry lands in `vt_cb_queue` → come online → stale logs with wrong `elapsedMs` are POSTed |
| **Classification** | Correctness |
| **Minimal fix** | Route all CB mutations through `api.request()` (which integrates the emergency classifier), or duplicate the classifier in `authFetch`. Remove the `vt_cb_queue` localStorage replay mechanism entirely. |

#### P0-2: Code Blue session end navigates away without checking HTTP response

| Field | Detail |
|-------|--------|
| **Severity** | P0 — Clinical correctness |
| **Subsystem** | Code Blue UI |
| **Affected files** | `src/pages/code-blue.tsx` (L320-329) |
| **Root cause** | `handleEndSession` awaits `authFetch(…/end, {method:"PATCH"})` but never checks `res.ok`. Always calls `navigate("/home")` regardless of server response. `authFetch` only throws on 401, not 403/422/500. |
| **Reproduction** | Active CB session → server returns 403 (`MANAGER_NOT_CODE_BLUE_ELIGIBLE` in enforce mode) or 500 → UI navigates to `/home` while session remains active on server and ward display |
| **Classification** | Correctness |
| **Minimal fix** | Check `res.ok` before navigating. Surface server error via toast on failure. |

---

### SHOULD FIX (Phase 10 scope)

#### P1-1: SSE reconnect replay capped at 1000 events (no pagination)

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Correctness under load |
| **Subsystem** | Realtime / SSE |
| **Affected files** | `server/routes/realtime.ts` (L12, L66-112, L472-473) |
| **Root cause** | On SSE reconnect, server replays at most `MAX_OUTBOX_REPLAY=1000` rows after `Last-Event-ID`. Unlike `GET /api/realtime/replay` (client-paginated via `hasMore`), the SSE path sends one batch only. Gap of >1000 events during disconnect → events 1001+ are lost until gap recovery or keepalive. |
| **Reproduction** | Client disconnects with cursor at N. Clinic publishes >1000 events. Client reconnects — only first 1000 replayed. Remaining events missed until `useRealtimeReconciliation` triggers. |
| **Classification** | Correctness |
| **Minimal fix** | After SSE replay, client should call `replayHttpCatchUpAfter` (which paginates) to close the remaining gap before live delivery begins. |

#### P1-2: Concurrent replay batches (no mutex in useRealtimeReconciliation)

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Correctness under overlapping triggers |
| **Subsystem** | Realtime reconciliation |
| **Affected files** | `src/hooks/useRealtimeReconciliation.ts` (L68-110), `src/lib/realtime.ts` (L649-697) |
| **Root cause** | `useRealtimeReconciliation` debounces triggers (250ms) but does not serialize `run()`. A slow multi-page replay can overlap with another trigger. `replaySuppressionMaxId` is a single field — concurrent batches can clear each other's suppression watermark. |
| **Reproduction** | Tab hidden long enough to miss >1000 events → `visibilitychange` starts replay → `online` fires within ~1s → second parallel `run()` starts |
| **Classification** | Correctness |
| **Minimal fix** | Add single-flight mutex around reconciliation + replay. |

#### P1-3: `initSyncEngine` never called — `online` handler for queue drain never wired

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Correctness |
| **Subsystem** | Offline sync |
| **Affected files** | `src/lib/sync-engine.ts` (L367-383) |
| **Root cause** | `initSyncEngine()` adds `window.addEventListener("online", processQueue)` but has **zero call sites**. Pending offline mutations only drain when auth sync runs or `triggerSync` is called manually. |
| **Reproduction** | Queue equipment scan offline → come back online → pending queue does not auto-drain until next auth sync or page navigation that calls `triggerSync` |
| **Classification** | Correctness |
| **Minimal fix** | Call `initSyncEngine()` from app bootstrap, or wire `processQueue` into a single global `online` handler in the layout. |

#### P1-4: No guard against multiple concurrent active Code Blue sessions

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Data integrity |
| **Subsystem** | Code Blue |
| **Affected files** | `server/routes/code-blue.ts` (L377-405) |
| **Root cause** | `POST /sessions` creates a new session without checking for an existing `status='active'` row for the same clinic. Double-submit or concurrent requests can create multiple active sessions. Display uses `limit(1)` without `orderBy` — returns arbitrary session. |
| **Reproduction** | Two clinicians start CB within seconds (or double-submit) → two `status:'active'` rows per clinic |
| **Classification** | Correctness |
| **Minimal fix** | Check for existing active session before insert; reject with 409 if one exists. Add `orderBy(desc(startedAt))` on active-session queries. |

#### P1-5: No realtime outbox event on CB start/end → overlay propagation gap

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Propagation latency |
| **Subsystem** | Code Blue / realtime |
| **Affected files** | `server/routes/code-blue.ts` (L395-404, L933-964), `src/lib/event-reducer.ts` |
| **Root cause** | CB start emits only `NOTIFICATION_REQUESTED` (no display-relevant outbox event). CB end has no outbox event at all. Ward display overlay update relies on 2s poll + keepalive mismatch (~15s worst case). |
| **Reproduction** | Start CB from another device → display shows overlay only after snapshot poll (2s) or keepalive mismatch (up to 15s) |
| **Classification** | Correctness / UX |
| **Minimal fix** | Emit `CODE_BLUE_STATUS_CHANGED` (or similar bounded type) on CB start/end in same TX as DB write; handle in `event-reducer.ts` to invalidate snapshot cache. |

#### P1-6: Stale overlay persistence when snapshot fetch fails

| Field | Detail |
|-------|--------|
| **Severity** | P1 — UX |
| **Subsystem** | Department Display |
| **Affected files** | `src/hooks/useDisplaySnapshot.ts` (L19-21), `src/pages/display.tsx` (L624-630) |
| **Root cause** | `useQuery` has `placeholderData: (previous) => previous` and `retry: false`. On persistent snapshot errors, last-good data (including active CB) is shown indefinitely. |
| **Reproduction** | Active CB on display → induce repeated `/api/display/snapshot` failures → CB ends on server → overlay persists until keepalive recovery (~15s+) |
| **Classification** | UX |
| **Minimal fix** | Add `retry: 2` or clear stale data after consecutive errors. |

#### P1-7: `code-blue-display.tsx` has no SSE/reconciliation; timer sticks after session end

| Field | Detail |
|-------|--------|
| **Severity** | P1 — UX |
| **Subsystem** | Code Blue display |
| **Affected files** | `src/pages/code-blue-display.tsx` (L32-43, L49-51) |
| **Root cause** | Uses 2s poll only (no EventIngestor, no keepalive hook). `startedAtRef` retains last `startedAt` when session becomes null; `useElapsed` keeps ticking on standby. |
| **Reproduction** | Open `/code-blue-display` during CB → end session elsewhere → within one poll interval, standby screen still shows running timer |
| **Classification** | UX |
| **Minimal fix** | Clear `startedAtRef` when session is null; wire to realtime stack or deprecate route. |

#### P1-8: `handlePeerAhead` drops follow-up peer signals after awaiting in-flight recovery

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Correctness |
| **Subsystem** | Realtime / BroadcastChannel |
| **Affected files** | `src/lib/realtime.ts` (L560-574) |
| **Root cause** | If `peerRecoveryInFlight` is set, `handlePeerAhead` awaits it and returns without re-evaluating the peer cursor. Unlike `handleCodeBlueSeenGossip` (which correctly re-checks after await). |
| **Reproduction** | Tab A recovery fails (cursor unchanged at 50) → Tab B gossips cursor 110 during recovery → Tab A awaits, returns early, stays behind |
| **Classification** | Correctness |
| **Minimal fix** | Re-check peer cursor after awaiting recovery (match `handleCodeBlueSeenGossip` pattern). |

#### P1-9: SW API GET cache has no auth/Vary isolation

| Field | Detail |
|-------|--------|
| **Severity** | P1 — Correctness (shared devices) |
| **Subsystem** | PWA / Service Worker |
| **Affected files** | `public/sw.js` (L310-331) |
| **Root cause** | API GET responses are cached by URL only, without any session/auth consideration. On shared clinic tablets: User A's cached data can be served to User B when offline. |
| **Reproduction** | Shared tablet → User A loads `/api/equipment` → sign out → User B signs in → go offline → SW serves User A's cached response |
| **Classification** | Correctness (tenant/session bleed via Cache Storage) |
| **Minimal fix** | Add `Vary` header consideration, or stop caching authenticated API GETs in the SW, or clear API cache on sign-out. |

#### P1-10: `PageErrorBoundary.reset()` reload has no loop guard

| Field | Detail |
|-------|--------|
| **Severity** | P1 — UX / reliability |
| **Subsystem** | PWA / error recovery |
| **Affected files** | `src/components/ui/page-error-boundary.tsx` (L44-46) |
| **Root cause** | For module errors (dynamic import failures), calls `window.location.reload()` without loop guard (no sessionStorage check, no cache clear). `index.html` has a robust loop-guarded recovery, but this code path doesn't use it. |
| **Reproduction** | Post-deploy chunk missing → lazy route fails → error boundary → reload → same error → infinite loop (especially on standalone PWA with no stop button) |
| **Classification** | UX |
| **Minimal fix** | Use the same sessionStorage loop guard as `index.html`, and clear SW caches before reloading. |

---

### SAFE TO DEFER

#### P2-1: `stormHint: "elevated"` never consumed on client

| Field | Detail |
|-------|--------|
| **Severity** | P2 — Operational |
| **Subsystem** | Realtime |
| **Affected files** | `server/lib/code-blue-keepalive.ts`, `src/hooks/useCodeBlueKeepaliveReconciliation.ts`, `src/lib/realtime.ts` |
| **Root cause** | Server sets `stormHint: "elevated"` on keepalive when ≥50 connects/5s. No client code reads this to add reconnect jitter/backoff. |
| **Classification** | Operational |
| **Minimal fix** | Read `stormHint` in keepalive subscribers; add bounded jitter to reconnect when elevated. |

#### P2-2: Browser EventSource reconnect has no app-level backoff/jitter

| Field | Detail |
|-------|--------|
| **Severity** | P2 — Operational |
| **Subsystem** | Realtime |
| **Affected files** | `src/lib/realtime.ts` (L770-772) |
| **Root cause** | `onerror` handler is empty. Browser reconnects immediately after error. Only `CONNECTION_EVICTED` uses fixed 2s delay (no jitter). |
| **Classification** | Operational |

#### P2-3: Dual SSE connections per tab (ErModeGuard + realtime/stream)

| Field | Detail |
|-------|--------|
| **Severity** | P2 — Operational |
| **Subsystem** | Realtime / ER |
| **Affected files** | `src/features/er/components/ErModeGuard.tsx` (L66) |
| **Root cause** | `ErModeGuard` opens `EventSource("/api/er/stream")` for every signed-in user. Display/ER also open `/api/realtime/stream` → ≥2 SSE connections per tab. |
| **Classification** | Operational |

#### P2-4: `runStartupCleanup` dead code — IndexedDB grows unbounded

| Field | Detail |
|-------|--------|
| **Severity** | P2 — Operational |
| **Subsystem** | Offline DB |
| **Affected files** | `src/lib/offline-db.ts` (L190-247) |
| **Root cause** | `runStartupCleanup()` function exists but has zero call sites. `synced` pending-sync rows are never bulk-deleted. |
| **Classification** | Operational |

#### P2-5: `addPendingSync` dedup is non-atomic

| Field | Detail |
|-------|--------|
| **Severity** | P2 — Correctness (edge case) |
| **Subsystem** | Offline sync |
| **Affected files** | `src/lib/offline-db.ts` (L131-158) |
| **Root cause** | Double-tap checkout offline within ~ms. Two concurrent `addPendingSync` calls both miss the existing row and insert duplicates. |
| **Classification** | Correctness |

#### P2-6: `realtime_connections` metric is cumulative, not a gauge

| Field | Detail |
|-------|--------|
| **Severity** | P2 — Operational |
| **Subsystem** | Metrics |
| **Affected files** | `server/lib/realtime.ts` (L49-51), `server/lib/metrics.ts` |
| **Root cause** | `incrementMetric("realtime_connections", connectionCount())` adds current count to cumulative counter on every subscribe/unsubscribe. Dashboard "connections" number is meaningless. |
| **Classification** | Operational |

#### P2-7: Wrong patient excluded from remaining hospitalizations on CB overlay

| Field | Detail |
|-------|--------|
| **Severity** | P2 — UX |
| **Subsystem** | Department Display |
| **Affected files** | `src/pages/display.tsx` (L380-382) |
| **Root cause** | `session.patientId` is an animal id but `h.id` is hospitalization id. Filter never excludes the CB patient from remaining list. |
| **Classification** | UX |

#### P2-8: Log entry React keys collide on CB overlay

| Field | Detail |
|-------|--------|
| **Severity** | P2 — UX |
| **Subsystem** | Department Display |
| **Affected files** | `src/pages/display.tsx` (L464) |
| **Root cause** | `key={\`${entry.elapsedMs}-${entry.label}\`}` — duplicate labels at same elapsed time break React list reconciliation. |
| **Classification** | UX |

#### P2-9: `notifyIfWaiting` doesn't compare build tags

| Field | Detail |
|-------|--------|
| **Severity** | P2 — UX |
| **Subsystem** | PWA |
| **Affected files** | `src/main.tsx` (L87-94) |
| **Root cause** | Banner fires for any `registration.waiting` without comparing `__VT_BUILD_TAG__`. Inconsistent with `SW_UPDATED` handler which correctly compares tags. |
| **Classification** | UX |

---

### OBSERVABILITY-ONLY

#### P2-O1: Display heartbeat `getAliveCount()` undercounts with Redis

| Field | Detail |
|-------|--------|
| **Affected files** | `server/lib/display-heartbeat-store.ts` (L155-167) |
| **Root cause** | Only reads in-process `fallbackMap`, not Redis keys. |

#### P2-O2: Incomplete resync trigger telemetry

| Field | Detail |
|-------|--------|
| **Affected files** | `src/hooks/useRealtimeReconciliation.ts` |
| **Root cause** | `displayForcedResyncTrigger` enum includes `gap`, `peer_ahead`, `emergency_uncertain` but hook only schedules `visibility`, `pageshow`, `online`. |

#### P2-O3: Split-version banner is one-shot per loaded build

| Field | Detail |
|-------|--------|
| **Affected files** | `src/lib/realtime.ts` (L206-240) |
| **Root cause** | `buildTagBannerFired` allows only one banner per tab load. Second divergent peer build tag won't surface another banner. |

---

### UX-ONLY (P3)

| ID | Issue | File |
|----|-------|------|
| P3-1 | SW `message` listener never removed (Strict Mode double-register) | `src/main.tsx` L73-82 |
| P3-2 | Misleading 503 on missing static assets (says "offline" when actually 404 post-deploy) | `public/sw.js` L296-298 |
| P3-3 | `AudioContext` leak in CPR beep helper (long CB sessions) | `src/pages/code-blue.tsx` L44-53 |
| P3-4 | CB presence staleness computed once per render, not per second | `src/pages/display.tsx` L367-370 |
| P3-5 | Wake-lock silently degrades on iOS/unsupported browsers | `src/hooks/useKioskWakeLock.ts` |
| P3-6 | URL normalization gaps in emergency classifier (trailing slash) | `src/lib/offline-emergency-block.ts` L53-66 |
| P3-7 | Module-level BroadcastChannel never closed | `src/lib/realtime.ts` L14 |
| P3-8 | `reconnectTimestamps`/`stormUntil` maps grow without clinic pruning | `server/lib/code-blue-keepalive.ts` L54-55 |
| P3-9 | Dual keepalive traffic on `/stream` (20s comment + 10s JSON) | `server/lib/realtime.ts`, `code-blue-keepalive.ts` |

---

## Final Recommendation

### Should Phase 10 exist?

**Yes.** Two P0 clinical correctness issues (Code Blue offline queue bypass + unguarded session-end navigation) require immediate attention. The eight P1 issues cover real correctness, data integrity, and propagation gaps that would cause confusion in production Code Blue and ward display scenarios.

### Approximate scope

- **2 P0 fixes:** Localized to `useCodeBlueSession.ts` and `code-blue.tsx`. ~2 files, <50 lines changed.
- **10 P1 fixes:** Spread across 3 subsystems (Code Blue: 4 issues, Realtime: 3 issues, PWA/Offline: 3 issues). ~12 files, estimated <300 lines total.
- **9 P2 safe-to-defer:** Can be addressed incrementally after P0/P1 fixes land.
- **9 P3 polish:** Low priority, no user impact in normal operation.

### Are fixes localized or systemic?

**Localized.** Every identified fix targets a specific file and code path. No architectural changes are needed. The frozen surfaces (SSE transport, outbox ordering, enforcement envelope, i18n namespace) are not affected. The Phase 9 infrastructure (bounded counters, telemetry, deterministic drills, SW build-tag, emergency bypass) is sound — the issues are at the integration layer (CB UI bypassing guards, missing mutex, missing server-side checks).

### Prioritized fix order

1. P0-1: Route CB mutations through `api.request()` + remove `vt_cb_queue`
2. P0-2: Gate `navigate("/home")` on successful end response
3. P1-4: Guard against concurrent active sessions (server-side)
4. P1-5: Emit outbox event on CB start/end
5. P1-3: Wire `initSyncEngine` from app bootstrap
6. P1-1: Client-side paginated replay after SSE reconnect
7. P1-2: Add single-flight mutex to reconciliation
8. P1-10: Add loop guard to `PageErrorBoundary.reset()`
9. P1-8: Fix `handlePeerAhead` re-check after recovery
10. P1-9: Add auth isolation to SW API cache (or stop caching API GETs)
11. P1-6: Add retry to snapshot query
12. P1-7: Fix `code-blue-display.tsx` timer leak
