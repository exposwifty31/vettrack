/**
 * OFF-07 — Canonical emergency / live API surface catalog (Phase 7).
 *
 * Source of truth: the `@vettrack/contracts` workspace package (`packages/contracts`).
 * This module preserves existing import paths in vettrack and tests.
 */
import { EMERGENCY_SERVER_ROUTE_ALLOWLIST as BASE_EMERGENCY_SERVER_ROUTE_ALLOWLIST } from "@vettrack/contracts";

export {
  type EmergencyEndpointClass,
  type EmergencyOfflineBlockMutation,
  EMERGENCY_OFFLINE_BLOCK_MUTATIONS,
  EMERGENCY_CACHE_BYPASS_PATHS,
  type EmergencyCacheBypassPath,
  normalizeEmergencyPathname,
  classifyEmergencyEndpointFromManifest,
} from "@vettrack/contracts";

/**
 * Phase 9 — Display-device pairing added admin + pairing routes to
 * `server/routes/display.ts` (`createDisplayRouter`). These are NON-emergency
 * surfaces (no SW cache bypass, not offline-blocked mutations); they are
 * catalogued here so the OFF-07 route ratchet stays green. The base allowlist
 * from `@vettrack/contracts` remains the upstream source of truth for the
 * emergency reads (snapshot/heartbeat/stream/…); this only appends the new
 * pairing/management routes local to this repo.
 */
const PHASE_9_DISPLAY_PAIRING_ROUTES = [
  "POST /api/display/pair/issue",
  "POST /api/display/pair/claim",
  "GET /api/display/devices",
  "PATCH /api/display/devices/:id",
  "POST /api/display/devices/:id/revoke",
] as const;

export const EMERGENCY_SERVER_ROUTE_ALLOWLIST: readonly string[] = [
  ...BASE_EMERGENCY_SERVER_ROUTE_ALLOWLIST,
  ...PHASE_9_DISPLAY_PAIRING_ROUTES,
];
