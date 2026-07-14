# R-RTC-1 — Real-time collaboration WS channel (SUB-SPEC + plan)

- **Covers:** three ephemeral, bidirectional collaboration features — live shift-chat typing/presence, command-board co-presence/cursors, and record co-presence. Owner-driven ("I have a bidirectional need … all three").
- **Additive to — and fully decoupled from — the SSE+outbox realtime.** SSE + `vt_event_outbox` stays the **sole** transport for all domain + emergency state (frozen). This is a **separate Socket.io channel** carrying only ephemeral signals.
- **Why Socket.io HERE (and never on the emergency path):** these signals are ephemeral, bidirectional, high-frequency, loss-tolerant, room-scoped — its actual sweet spot. The investigation (parent plan) rejected #95's Socket.io because it put durable/emergency traffic on a lossy channel and trusted client identity; this subspec does neither.
- **Card contract:** RED→GREEN→verify per card. Deps added: `socket.io`, `socket.io-client`, `@socket.io/redis-adapter` — isolated to this channel.

## Frozen guardrails (every card)

The WS channel carries **only ephemeral collaboration signals** (presence, typing, cursors, viewing/editing) · it **NEVER** carries domain events, cache invalidations, or Code Blue/emergency state · it is **never a durable store** (no replay, no ordering guarantees) · **no core action is ever gated on it** · **if the WS channel is entirely down, ZERO domain/emergency correctness is affected** — per-surface degradation: chat degrades to REST-poll `getPresence`/`typing` (today's path); board degrades to no peer cursors/presence shown (static view, zero effect on functionality); record views degrade to no viewing/editing indicators shown (advisory-only, OCC guard unaffected) — proven by the required isolation test in R-RTC-1.7 · **bounded-enum telemetry** only (no PII, no raw coordinates) · auth reads `role`+`clinicId` from the **DB**, never from `handshake.auth` claims.

## Reuse anchors (verify at build)

`server/lib/display-heartbeat-store.ts` (the ephemeral-presence pattern: Redis short-TTL + bounded in-process `Map` fallback, no persistent identity) · `server/routes/shift-chat.ts` + `server/lib/shift-chat-presence.ts` (`touchPresence`/`getPresence`, existing REST-poll typing/presence to degrade to) · `server/middleware/auth.ts` (session validation + DB role read — reuse for the handshake) · `src/board/*` (board surfaces) · `server/lib/metrics.ts` (`incrementMetric()` bounded union) · the existing Redis (`server/lib/redis.js`, optional in dev).

---

### R-RTC-1.1 · WS server foundation: authenticated handshake + clinic-scoped rooms

- **Goal:** stand up a Socket.io server on the existing HTTP server (`server/index.ts`) under an isolated `server/lib/realtime-collab/`. **Handshake auth (the bot's fatal flaw, fixed):** validate the session via the existing Clerk/session path and read `role`+`clinicId` from the **DB**; reject unauthenticated sockets; never trust `handshake.auth.userId`. **Rooms (pinned):** `clinic:<id>:chat`, `clinic:<id>:board`, `clinic:<id>:record:<type>:<id>` — a socket may only join rooms for its own `clinicId` (no cross-clinic join). **Record room authorization:** joining `clinic:<id>:record:<type>:<id>` also enforces the same server-side record-level ACL/role check used by the existing REST record-access path (reuse anchor); reject unauthorized same-clinic record-room joins; `clinic:<id>:chat` and `clinic:<id>:board` joins remain clinic-scoped only.
- **RED:** `tests/collab-ws-auth.test.ts` — unauthenticated handshake rejected; a handshake supplying a **client-claimed** userId/role is ignored (identity comes from the DB session); a socket cannot join another clinic's room; **a user cannot join a record room for a record in their own clinic that they aren't authorized to view/edit** (same-clinic unauthorized record-room join rejected).
- **Guardrail:** no domain/emergency traffic on this server; it shares the HTTP server but is a distinct namespace/path from `/api/realtime/*` (SSE).
- **Verify:** `pnpm test -- tests/collab-ws-auth.test.ts` + `npx tsc --noEmit` + `pnpm typecheck`.

### R-RTC-1.2 · Feature 1 — shift-chat live (typing + presence push)

- **Goal:** in `clinic:<id>:chat`, events `typing` (userId, on/off) and `presence` (join/leave/heartbeat). **Message delivery stays durable** on the existing REST-persist + SSE path (source of truth); WS carries only the ephemeral typing indicator, presence, and a lightweight "new message" nudge (`chat-message-nudge`, carries message/sequence identifier for dedup, client coalesces/debounces so repeated emissions + reconnects trigger at most one refetch per new message) that triggers the existing refetch. **WS is NOT the message store.** When WS is down, the panel degrades to today's REST-poll `getPresence`/`typing`. **Event identity (never client-supplied):** event handling must never accept client-supplied userId; identity always comes from the authenticated socket's DB-backed session.
- **RED:** `tests/collab-shift-chat.test.ts` — two sockets in the same chat room see each other's `typing`/`presence`; a message still persists + delivers via REST/SSE with the WS channel disabled; **duplicate nudges are coalesced into exactly one refetch** while REST/SSE remains the source of truth for message content; client-supplied userId in an event payload is ignored (identity derived from socket session).
- **Guardrail:** never persist chat messages over WS; the nudge is advisory.
- **Verify:** the test + a manual two-client typing spot-check.

### R-RTC-1.3 · Feature 2 — command-board co-presence + cursors

- **Goal:** in `clinic:<id>:board`, events `board-presence` (who's on `/board`), `cursor` (client-throttled ~10–20/s `{x,y,userId}`), `selection` (highlighted card/entity). Pure ephemeral fan-out; no persistence. Client throttles cursor emission; **server enforces per-socket, per-clinic rate limiting** for `cursor`/`selection` events (in addition to client throttle) **and bounded payload validation** (reject malformed/oversized payloads) so a misbehaving client can't bypass client throttle; valid events relay to the room. When WS is down, board degrades to static view (no peer cursors/presence shown, zero effect on core functionality).
- **RED:** `tests/collab-board.test.ts` — two board sockets exchange presence/cursor/selection; cursor emission is throttled (N rapid moves → ≤ the throttle rate emitted); a dropped socket is removed from board presence; **sending oversized/over-limit events are rejected/not relayed while valid events continue to fan out normally**.
- **Guardrail:** glance surface — do not add durable state or block board rendering on the socket.
- **Verify:** the test + a two-client board spot-check.

### R-RTC-1.4 · Feature 3 — record co-presence (advisory)

- **Goal:** in `clinic:<id>:record:<type>:<id>`, events `viewing`/`editing` (userId, recordType, recordId) with TTL — surfaces "Alice is editing this task" to coordinate handoffs. **Advisory only:** it never locks or blocks edits; the server's OCC/version guards remain the sole conflict authority. Join on record-detail mount, leave on unmount, TTL cleanup for dropped sockets. **Event identity + validation (never client-supplied):** server validates the socket's authorized room membership and derives/validates recordType+recordId from that membership (not from client-supplied event payload fields) before publishing presence events; identity always comes from the authenticated socket's DB-backed session. When WS is down, record views degrade to no viewing/editing indicators shown (advisory-only, OCC guard unaffected).
- **RED:** `tests/collab-record-presence.test.ts` — two sockets on the same record see each other's viewing/editing; a dropped socket expires via TTL; **co-presence never blocks or alters a concurrent edit** (the OCC guard still decides); recordType+recordId are derived from authorized room membership, not from client payload (server rejects mismatched payload fields).
- **Guardrail:** advisory, never authoritative for conflicts.
- **Verify:** the test.

### R-RTC-1.5 · Presence store + horizontal scaling

- **Goal:** reuse the `display-heartbeat-store` pattern — Redis short-TTL (~90 s) with **socket/session-scoped presence leases** (not userId-alone keying), aggregated/reference-counted per user so presence is removed only when all leases for that user in that room have expired or disconnected (prevents one socket disconnecting from incorrectly removing presence while another socket for that same user is still active); bounded in-process `Map` fallback when Redis is absent. **No new DB tables, no persistent identity, bounded payloads** (userId + display name only). **Scaling:** prod (Redis present) → `@socket.io/redis-adapter` fans rooms across instances; dev/no-Redis → in-memory single-instance (cross-instance fan-out degrades gracefully — acceptable for ephemeral signals). **Production Redis requirement:** production must require Redis and fail startup if unavailable/misconfigured; bounded in-process fallback permitted only under explicit development-mode setting; if production intentionally omits Redis, that must be an explicit single-instance configuration choice (not a silent fallback). **Deploy config:** prefer `transports: ['websocket']` on Railway to avoid sticky-session affinity, else enable affinity.
- **RED:** `tests/collab-presence-store.test.ts` — presence entry expires after TTL; in-process fallback bounded (no unbounded growth); Redis-present path uses the adapter (mock); **multiple sockets for the same user maintain presence until all leases expire/disconnect** (not removed when one socket disconnects while another remains).
- **Guardrail:** ephemeral only; presence loss under degraded mode is acceptable and must not error.
- **Verify:** the test + a 2-instance manual fan-out check with Redis.

### R-RTC-1.6 · Client wrapper + graceful degradation

- **Goal:** `src/lib/collab-socket.ts` — a thin `socket.io-client` wrapper, connected **lazily** only on surfaces that use it (shift-chat panel, `/board`, record-detail). Auto-reconnect. On the Capacitor native shell or restrictive networks where WS fails, **per-surface degradation:** shift-chat degrades to REST-poll presence (feature 1 already has it); board simply doesn't render peer cursors/presence (features 2/3 have no REST/SSE equivalent, degrade to static view); record views don't render viewing/editing indicators (advisory-only, OCC guard unaffected). **Never gate a core action on the socket.**
- **RED:** `tests/collab-client-degrade.test.tsx` — with WS unavailable, the shift-chat panel still loads + functions via REST-poll; board loads without peer cursors/presence shown; record views load without viewing/editing indicators; no core action is blocked; the wrapper only connects on the using surfaces (not app-wide).
- **Guardrail:** lazy connect; no app-wide socket; no core-flow dependency.
- **Verify:** the test + an iOS Capacitor spot-check with WS blocked.

### R-RTC-1.7 · Bounded telemetry + the required emergency-isolation gate

- **Goal:** bounded-enum telemetry only (complete closed set: `collab_ws_connected`, `collab_ws_disconnected`, `collab_typing`, `collab_presence`, `collab_cursor_dropped`, `collab_board_rate_limited`, `collab_record_presence`) through `incrementMetric()` — closed union, no PII, no raw coordinates; `incrementMetric()` must reject unknown or dynamically constructed metric names at runtime. **Explicit disable switch:** env/feature-flag switch to disable the whole collaboration channel (e.g. `COLLAB_WS_ENABLED=false`, default enabled in prod once shipped but disableable). **Non-fatal startup boundary:** Socket.io/Redis initialization wrapped in a non-fatal startup boundary in `server/index.ts` so failures there never block SSE, `vt_event_outbox`, or Code Blue startup.
- **RED (the load-bearing acceptance test):** `tests/collab-emergency-isolation.test.ts` — with the WS collaboration channel **forcibly disabled AND Redis unavailable**, Code Blue start/log/end **and** all SSE domain events still work end-to-end (proves zero coupling to the emergency/outbox path). Plus the closed-enum telemetry rejection test (validates against the exact enumerated metric set above, rejects unknown/dynamically-constructed names).
- **Guardrail:** this isolation test is a **merge gate** — the channel does not ship unless disabling it (with Redis also unavailable) leaves domain+emergency correctness fully intact; per-surface degradation guarantees: chat degrades to REST-poll presence/typing; board and record surfaces degrade to no peer collaboration signals shown; zero effect on core functionality in all three cases.
- **Verify:** `pnpm test -- tests/collab-emergency-isolation.test.ts` + full `pnpm test` + `pnpm typecheck` + the Phase-9 realtime drills (prove SSE/outbox/Code Blue untouched).

## Resolved (pinned, no open choices)

- **Transport for domain/emergency:** unchanged — SSE + `vt_event_outbox`, frozen. WS is additive only.
- **Durability:** the WS channel is intentionally ephemeral (no replay/ordering). Anything needing durability stays on REST-persist + SSE.
- **Auth:** DB-sourced identity on the handshake; client claims ignored.
- **Message store:** REST + SSE remains the source of truth for chat messages; WS carries only typing/presence + a refetch nudge.
- **Record co-presence:** advisory; OCC/version guards remain the conflict authority.
- **Scaling:** Redis adapter in prod (required, fail startup if unavailable/misconfigured); bounded in-process fallback only under explicit dev-mode; single-instance prod must be an explicit configuration choice (not a silent fallback).
- **Isolation:** disabling the channel must not affect any domain/emergency path — enforced by R-RTC-1.7 as a merge gate.
