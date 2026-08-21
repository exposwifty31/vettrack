/**
 * CANONICAL source of truth for the emergency offline-block list, SW cache-bypass
 * paths, and the base server-route allowlist.
 *
 * Direction of truth (do not re-sync the wrong way): this @vettrack/contracts module
 * is the source. `shared/emergency-surfaces.manifest.ts` RE-EXPORTS from here and only
 * appends repo-local, explicitly NON-emergency routes (the Phase-9 display-pairing
 * catalogue). Add real emergency surfaces HERE so RN and every contracts consumer see
 * them; the OFF-07 parity gate (tests/offline-phase-7-emergency-surface-parity.test.ts)
 * ratchets the manifest against public/sw.js and the classifier.
 */

// ─── A. Offline block mutations ───────────────────────────────────────────────

export type EmergencyEndpointClass = "start" | "log" | "end" | "presence";

export type EmergencyOfflineBlockMutation = {
  method: "POST" | "PATCH";
  pathPattern: RegExp;
  class: EmergencyEndpointClass;
  samplePathname: string;
};

export const EMERGENCY_OFFLINE_BLOCK_MUTATIONS: readonly EmergencyOfflineBlockMutation[] = [
  { method: "POST", pathPattern: /^\/api\/code-blue\/sessions$/, class: "start", samplePathname: "/api/code-blue/sessions" },
  // R-CBF-1.1 — one-tap orchestration start. Composes claim → nearest cart → CAS
  // reserve → session → outbox paging; a `start` emergency mutation, never queued.
  { method: "POST", pathPattern: /^\/api\/code-blue\/one-tap$/, class: "start", samplePathname: "/api/code-blue/one-tap" },
  { method: "POST", pathPattern: /^\/api\/code-blue\/sessions\/[^/]+\/logs$/, class: "log", samplePathname: "/api/code-blue/sessions/abc-123/logs" },
  { method: "PATCH", pathPattern: /^\/api\/code-blue\/sessions\/[^/]+\/end$/, class: "end", samplePathname: "/api/code-blue/sessions/abc-123/end" },
  { method: "PATCH", pathPattern: /^\/api\/code-blue\/sessions\/[^/]+\/presence$/, class: "presence", samplePathname: "/api/code-blue/sessions/abc-123/presence" },
] as const;

// ─── B. SW cache bypass ───────────────────────────────────────────────────────

export const EMERGENCY_CACHE_BYPASS_PATHS = [
  "/api/display/snapshot",
  "/api/code-blue/sessions/active",
  "/api/realtime/stream",
  "/api/realtime/replay",
  "/api/realtime/outbox-head",
  "/api/realtime/telemetry",
] as const;

export type EmergencyCacheBypassPath = (typeof EMERGENCY_CACHE_BYPASS_PATHS)[number];

// ─── C. Server route allowlist ────────────────────────────────────────────────

export const EMERGENCY_SERVER_ROUTE_ALLOWLIST: readonly string[] = [
  "POST /api/code-blue/events",
  "PATCH /api/code-blue/events/:id",
  "GET /api/code-blue/events",
  "POST /api/code-blue/sessions",
  "POST /api/code-blue/one-tap",
  "GET /api/code-blue/sessions/active",
  // Discovery read: who would the manager check accept right now. Not an
  // offline-block mutation (it is a GET) and not a cache-bypass path — the SW
  // never caches API GETs at all, so there is nothing to deny-list.
  "GET /api/code-blue/eligible-managers",
  "POST /api/code-blue/sessions/:id/logs",
  "PATCH /api/code-blue/sessions/:id/presence",
  "PATCH /api/code-blue/sessions/:id/end",
  "GET /api/code-blue/history",
  "GET /api/code-blue/reconciliation",
  "GET /api/code-blue/sessions/:id/dispenses",
  "PATCH /api/code-blue/sessions/:id/reconcile",
  "POST /api/code-blue/sessions/:id/manual-billing",
  "GET /api/realtime/replay",
  "GET /api/realtime/outbox-head",
  "POST /api/realtime/telemetry",
  "GET /api/realtime/stream",
  "GET /api/realtime/",
  "GET /api/display/snapshot",
  "POST /api/display/heartbeat",
] as const;

// ─── Utilities ────────────────────────────────────────────────────────────────

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
