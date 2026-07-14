/**
 * Ported verbatim from shared/emergency-surfaces.manifest.ts
 * Source of truth for offline block list, SW cache bypass, and server route allowlist.
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
  "GET /api/code-blue/sessions/active",
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
