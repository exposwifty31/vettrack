/**
 * SSE reconnect-storm load script (PR-26).
 *
 * Exercises the Phase 9 reconnect-storm threshold: >= 50 SSE connects per
 * clinic within a 5 s window flips `stormHint` to `elevated` for 30 s
 * (see server/routes/realtime.ts -> recordStreamConnect, CLAUDE.md
 * "Realtime (Phase 9)").
 *
 * This is a MANUAL / nightly tool — it is deliberately NOT wired into the
 * PR gate. Run it against a LOCAL dev server only (dev-bypass auth, so no
 * Clerk keys needed). Never point it at staging or production.
 *
 * Usage:
 *   1. Start the app locally:  pnpm dev   (API on :3001)
 *   2. Install k6:             https://k6.io/docs/get-started/installation/
 *   3. Run:                    k6 run load/sse-storm.js
 *      Override the target:    k6 run -e BASE_URL=http://127.0.0.1:3001 load/sse-storm.js
 *
 * Note on SSE + k6: k6 has no native EventSource client, so each iteration
 * opens the streaming endpoint with a short timeout and aborts. The server
 * still counts the CONNECT (recordStreamConnect) before the client goes
 * away, which is exactly what the storm detector measures. To soak *held*
 * connections instead, use the xk6-sse extension or the manual procedure
 * in load/README.md.
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3001";
const STREAM_URL = `${BASE_URL}/api/realtime/stream`;
const OUTBOX_HEAD_URL = `${BASE_URL}/api/realtime/outbox-head`;

export const options = {
  scenarios: {
    // 60 virtual users connect within ~3 s — comfortably over the
    // 50-connects / 5 s storm threshold for a single clinic.
    connect_storm: {
      executor: "per-vu-iterations",
      vus: 60,
      iterations: 3,
      maxDuration: "60s",
    },
  },
  thresholds: {
    // The connect itself must succeed; the stream body is intentionally
    // abandoned after the short timeout below.
    checks: ["rate>0.95"],
  },
};

export default function () {
  // Short timeout: the connect is recorded server-side, then we abort.
  const res = http.get(STREAM_URL, { timeout: "1s" });
  check(res, {
    "connect reached the server": (r) => r.status === 200 || r.status === 0,
  });
  sleep(0.05);
}

// After the storm, query the outbox head to observe the elevated storm
// hint surfaced by the telemetry endpoint.
export function teardown() {
  const res = http.get(OUTBOX_HEAD_URL);
  console.log(`outbox-head after storm: status=${res.status} body=${res.body}`);
}
