/**
 * OFF-07 — Canonical emergency / live API surface catalog (Phase 7).
 *
 * Single source of truth for:
 *   A. Offline mutation block list (classifyEmergencyEndpoint)
 *   B. Service worker cache bypass denylist (public/sw.js EMERGENCY_BYPASS_PATHS)
 *   C. Express route ratchet allowlist (code-blue, realtime, display routers)
 *
 * CI: tests/offline-phase-7-emergency-surface-parity.test.ts
 */

// ─── A. Offline block mutations (Code Blue only) ─────────────────────────────
//
// Phase 9 doctrine: emergency *reads* are not offline-blocked; only these
// session mutations must never enqueue pendingSync.

export type EmergencyEndpointClass = "start" | "log" | "end" | "presence";

export type EmergencyOfflineBlockMutation = {
  method: "POST" | "PATCH";
  pathPattern: RegExp;
  class: EmergencyEndpointClass;
  /** Representative pathname for parity tests (query strings applied separately). */
  samplePathname: string;
};

export const EMERGENCY_OFFLINE_BLOCK_MUTATIONS: readonly EmergencyOfflineBlockMutation[] = [
  {
    method: "POST",
    pathPattern: /^\/api\/code-blue\/sessions$/,
    class: "start",
    samplePathname: "/api/code-blue/sessions",
  },
  {
    method: "POST",
    pathPattern: /^\/api\/code-blue\/sessions\/[^/]+\/logs$/,
    class: "log",
    samplePathname: "/api/code-blue/sessions/abc-123/logs",
  },
  {
    method: "PATCH",
    pathPattern: /^\/api\/code-blue\/sessions\/[^/]+\/end$/,
    class: "end",
    samplePathname: "/api/code-blue/sessions/abc-123/end",
  },
  {
    method: "PATCH",
    pathPattern: /^\/api\/code-blue\/sessions\/[^/]+\/presence$/,
    class: "presence",
    samplePathname: "/api/code-blue/sessions/abc-123/presence",
  },
] as const;

// ─── B. SW cache bypass (Phase 9 frozen live reads) ────────────────────────────
//
// Must match public/sw.js `EMERGENCY_BYPASS_PATHS` exactly (set equality).
// Do not change SW fetch-handler behavior here — denylist sync only.

export const EMERGENCY_CACHE_BYPASS_PATHS = [
  "/api/display/snapshot",
  "/api/code-blue/sessions/active",
  "/api/realtime/stream",
  "/api/realtime/replay",
  "/api/realtime/outbox-head",
  "/api/realtime/telemetry",
] as const;

export type EmergencyCacheBypassPath = (typeof EMERGENCY_CACHE_BYPASS_PATHS)[number];

// ─── C. Server route allowlist (CI ratchet) ──────────────────────────────────
//
// Stable keys: `METHOD /api/...` with Express `:param` segments.
// Seeded from server/routes/code-blue.ts, realtime.ts, display.ts on main.
//
// Coverage rules (enforced in parity tests):
//   - Code Blue session mutations (POST/PATCH start/log/end/presence) → section A
//   - Phase 9 live reads (active session, display snapshot, realtime stream family)
//     → section B
//   - Other code-blue GET routes (history, reconciliation, admin dispenses, legacy
//     /events) → allowlisted here only; SW denylist not required

export const EMERGENCY_SERVER_ROUTE_ALLOWLIST: readonly string[] = [
  // code-blue — legacy archive
  "POST /api/code-blue/events",
  "PATCH /api/code-blue/events/:id",
  "GET /api/code-blue/events",
  // code-blue — live sessions
  "POST /api/code-blue/sessions",
  "GET /api/code-blue/sessions/active",
  "POST /api/code-blue/sessions/:id/logs",
  "PATCH /api/code-blue/sessions/:id/presence",
  "PATCH /api/code-blue/sessions/:id/end",
  "GET /api/code-blue/history",
  "GET /api/code-blue/reconciliation",
  "GET /api/code-blue/sessions/:id/dispenses",
  "PATCH /api/code-blue/sessions/:id/reconcile",
  "POST /api/code-blue/sessions/:id/manual-billing",
  // realtime
  "GET /api/realtime/replay",
  "GET /api/realtime/outbox-head",
  "POST /api/realtime/telemetry",
  "GET /api/realtime/stream",
  "GET /api/realtime/",
  // display
  "GET /api/display/snapshot",
  "POST /api/display/heartbeat",
] as const;

/** Normalize URL/pathname for classifier + parity: strip query, trim trailing slashes. */
export function normalizeEmergencyPathname(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    pathname = url.split("?")[0];
  }
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/, "");
  }
  return pathname;
}

/** Manifest-only classifier (parity reference). Production uses offline-emergency-block.ts. */
export function classifyEmergencyEndpointFromManifest(
  url: string,
  method: string,
): EmergencyEndpointClass | null {
  const upperMethod = method.toUpperCase();
  const pathname = normalizeEmergencyPathname(url);
  for (const entry of EMERGENCY_OFFLINE_BLOCK_MUTATIONS) {
    if (upperMethod === entry.method && entry.pathPattern.test(pathname)) {
      return entry.class;
    }
  }
  return null;
}
