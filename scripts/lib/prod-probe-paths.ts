/**
 * The paths `scripts/verify-prod-deploy.ts` probes against a deployed server.
 *
 * WHY THIS IS A MODULE AND NOT A LITERAL IN THE SCRIPT. The script calls `main()`
 * at import time, so a test cannot import it without opening sockets. The list
 * therefore lives here, where `tests/api-client-server-path-contract.test.ts` can
 * read it and assert — at PR time, in CI, offline — that every path on it is a
 * path a client actually calls AND a route the server actually registers.
 *
 * WHY THAT ASSERTION EXISTS. On 2026-08-16 this list was run against production
 * for the first time (the deploy verifier had never reached its probes: it polled
 * `/api/version` for `gitCommit`, which was `null`, and died on its own timeout).
 * It reported two failures, and NEITHER was a production defect:
 *
 *   /api/billing                 — no server router, no mount, and zero client
 *                                  fetch call sites. The only references were dead
 *                                  entries in src/lib/query-keys/registry.ts.
 *   /api/shift-handover/summary  — the router IS mounted, but serves `/current`
 *                                  and `/:id/acknowledge`. `/summary` exists on
 *                                  neither side; the client calls `/current`
 *                                  (src/lib/api.ts:1474).
 *
 * So two of five "client paths" were asked by no client. The script's own comment
 * said the list "must ask the question the client asks" — and a comment is not a
 * check. Wiring this into CI with those two entries would have produced a
 * permanently red post-deploy step on two non-defects, which is how a team learns
 * to ignore red.
 *
 * WHAT A PROBE MUST BE. Each entry is (a) requested by client code, (b) resolvable
 * to a registered server route, (c) safe to GET unauthenticated, and (d) expected
 * to answer `401 application/json` when unauthenticated. The static test covers
 * (a) and (b) — it cannot see middleware order, so (c) and (d) are established by
 * running the verifier against the deployed server, which is the point of the
 * script. Adding a public endpoint here would fail every run: the probe asserts
 * 401, so `/api/health` and `/api/version` belong nowhere near this list.
 *
 * NEVER the server's own mount string. Until 2026-08-14 this list carried
 * `/api/clinical/me/active` — the mount — which answered a clean 401 JSON and
 * passed for ~24h while `/api/clinical-check-in/me/active`, the path both clients
 * call, fell through to the SPA catch-all as 200 text/html. A probe that asks the
 * server about itself cannot detect client/server drift.
 */

/**
 * Authenticated client surfaces, one per area that a mount-boundary drift would
 * silently break. Deliberately a representative spread, not an exhaustive list:
 * the client↔server path contract test already covers all ~200 client paths
 * statically. These probes exist to catch what static analysis cannot — a path
 * that is correct in the source tree but not mounted in the BUILD THAT IS LIVE.
 */
export const PROD_CLIENT_PROBE_PATHS: readonly string[] = [
  "/api/appointments",
  "/api/tasks/dashboard",
  // The doctor shift gate — the A1 defect this whole surface was built to catch.
  "/api/clinical-check-in/me/active",
  // Replaces "/api/shift-handover/summary", which no client ever called.
  "/api/shift-handover/current",
  // Replaces "/api/billing", which never existed on either side. The emergency
  // surface is the highest-consequence path in the product and had no probe at all.
  "/api/code-blue/sessions/active",
] as const;

/**
 * An unmatched `/api/*` path must answer JSON 404, never the SPA shell. This is
 * the generalized A1-root guard: without it, any future client/server path drift
 * reappears as a misleading 200 text/html instead of a debuggable error.
 *
 * Not subject to the client-reference assertion, for the obvious reason: no client
 * may ever call it.
 */
export const NOT_FOUND_PROBE_PATH = "/api/__does_not_exist__";
