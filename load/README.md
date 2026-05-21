# Load / soak scripts

Manual, out-of-band performance tooling. **Nothing here runs in the PR gate.**
Run these against a **local dev server only** — never staging or production.

## `sse-storm.js` — reconnect-storm threshold (PR-26 / finding PF-01)

Exercises the Phase 9 reconnect-storm detector: **≥ 50 SSE connects per clinic
within a 5 s window** flips `stormHint` to `elevated` for 30 s
(`server/routes/realtime.ts` → `recordStreamConnect`).

### Run

```bash
# 1. Start the app locally (dev-bypass auth — no Clerk keys needed)
pnpm dev                     # API on :3001

# 2. Install k6 — https://k6.io/docs/get-started/installation/

# 3. Fire the storm
k6 run load/sse-storm.js
# or against an explicit target
k6 run -e BASE_URL=http://127.0.0.1:3001 load/sse-storm.js
```

60 virtual users open `/api/realtime/stream` within ~3 s, well over the
50-connects / 5 s threshold. The server records each connect even though k6
abandons the stream body after a 1 s timeout.

### Verifying the storm hint

`KEEPALIVE` events carry `{ activeCodeBlueSessionId, stormHint }`. After the
storm, observe `stormHint: "elevated"` for ~30 s by holding one real SSE
connection (browser devtools, or `curl -N`):

```bash
curl -N http://127.0.0.1:3001/api/realtime/stream
```

## Manual SSE soak (held connections)

k6 has no native `EventSource`. To soak **held** connections (not just the
connect rate), either:

- use the `xk6-sse` extension (`xk6 build --with github.com/phymbert/xk6-sse`), or
- open N browser tabs / `curl -N` sessions and watch `/api/realtime/telemetry`
  and server logs for connection counts and storm transitions.
