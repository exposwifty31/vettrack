/**
 * OFF-07 — Canonical emergency / live API surface catalog (Phase 7).
 *
 * Source of truth: `@vettrack/contracts` from exposwifty31/literate-dollop (`packages/contracts`).
 * This module preserves existing import paths in vettrack and tests.
 */
export {
  type EmergencyEndpointClass,
  type EmergencyOfflineBlockMutation,
  EMERGENCY_OFFLINE_BLOCK_MUTATIONS,
  EMERGENCY_CACHE_BYPASS_PATHS,
  type EmergencyCacheBypassPath,
  EMERGENCY_SERVER_ROUTE_ALLOWLIST,
  normalizeEmergencyPathname,
  classifyEmergencyEndpointFromManifest,
} from "@vettrack/contracts";
