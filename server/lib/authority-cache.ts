/**
 * Phase 2.5 PR 6 — Authority cache + invalidation layer.
 *
 * This module exclusively owns the in-process cache state behind the
 * authority resolver. It exposes read-through wrappers around the two
 * DB-input surfaces (`getOpenClinicalCheckIn`, `resolveCurrentRole`) and a
 * small invalidation API for writer-side hooks.
 *
 * Architectural boundary (load-bearing):
 *   server/lib/authority.ts MUST NOT import the TtlCache class, touch cache
 *   instances directly, inspect inflight maps, or call invalidate* / bumpEpoch.
 *   Its only contact surface is the two cached wrappers exported below.
 *
 * Behavior is gated by the per-request env flag AUTHORITY_CACHE_V1. When the
 * flag is not "true", the wrappers short-circuit to the underlying lookup
 * with no key construction, no Map touches, and no Promise wrapping — keeping
 * the cache-off path byte-identical to current production behavior.
 *
 * Multi-instance consistency note: invalidation is process-local. Cross-pod
 * consistency relies on the TTL window (30s check-in / 60s shift). Future
 * enforcement work cannot assume strong distributed consistency from this
 * layer; if it requires stronger guarantees, a separate distributed-
 * coordination PR is required.
 *
 * fallbackRole key cardinality: including fallbackRole in the shift key
 * raises per-user cardinality from 1 to at most ~5 (number of role values),
 * but only the user's current role is queried at runtime, so steady-state
 * cardinality remains ~1 per user with at most one orphan after a role
 * change (cleaned up by TTL or the PATCH /:id/role invalidation hook).
 *
 * Display-name dependency: ShiftLookupCache values depend on the
 * vt_users.name/displayName columns via resolveCurrentRole's name
 * canonicalization. Mutating either column must trigger invalidateForUser to
 * preserve the ShiftLookupCache key correctness invariant.
 *
 * Epoch-map boundedness: epoch counters are co-evicted with their cache
 * entries via the TtlCache onEvict hook, bounding memory by maxEntries.
 *
 * Timezone semantics: dayBucket is derived from toLocalDateString(now), the
 * exact same helper used by the shift query at server/lib/role-resolution.ts.
 * The helper is server-local; clinics in different timezones from the server
 * share the same potential calendar-day misalignment as the shift query
 * already has. This PR neither introduces nor fixes that.
 */

import {
  getOpenClinicalCheckIn,
  type GetOpenClinicalCheckInInput,
  type OpenClinicalCheckInRow,
} from "./check-in-resolution.js";
import { incrementMetric } from "./metrics.js";
import {
  resolveCurrentRole,
  toLocalDateString,
  type RoleResolutionInput,
  type RoleResolutionResult,
} from "./role-resolution.js";
import { TtlCache } from "./analytics-cache.js";
import { getAllowedOperationalRoles } from "../services/clinical-check-in.js";
import type { OperationalRole } from "../../shared/authority.js";

const CHECKIN_TTL_MS = 30_000;
const SHIFT_TTL_MS = 60_000;
// Phase 2.5 PR 7 — allowlist cache TTL bounds OPROLE revocation latency.
// Must be ≤ 60s by §5.4 contract.
const ALLOWLIST_TTL_MS = 60_000;
const MAX_ENTRIES_PER_CACHE = 10_000;

const NONE = "NONE" as const;
type CheckInCached = OpenClinicalCheckInRow | typeof NONE;
type ShiftCached = RoleResolutionResult | typeof NONE;

// Phase 2.5 PR 7 — allowlist wrapper local types. The element type is the
// non-null branch of OperationalRole (only emitted values; never "unknown",
// never null).
type NonNullOperationalRole = Exclude<OperationalRole, null>;
type AllowlistCached = readonly NonNullOperationalRole[];

/**
 * Phase 2.5 PR 7 — discriminated result returned by
 * getAllowedOperationalRolesCached. The wrapper owns hit/miss/error
 * categorization internally; the OPROLE evaluator consumes this single shape
 * and never re-implements the cache-state branching.
 */
export type AllowlistFetchResult =
  | { kind: "ok"; allowlist: readonly NonNullOperationalRole[] }
  | { kind: "error" };

function isCacheEnabled(): boolean {
  return process.env.AUTHORITY_CACHE_V1 === "true";
}

// ---------------------------------------------------------------------------
// Internal state. Module-private — never re-exported.
// ---------------------------------------------------------------------------

const checkInInflight = new Map<string, Promise<OpenClinicalCheckInRow | null>>();
const shiftInflight = new Map<string, Promise<RoleResolutionResult>>();

const checkInCache = new TtlCache<CheckInCached>({
  ttlMs: CHECKIN_TTL_MS,
  maxEntries: MAX_ENTRIES_PER_CACHE,
  onEvict: (key) => {
    checkInInflight.delete(key);
  },
  onSetError: () => {
    incrementMetric("authority_cache_error_set");
  },
  onEvicted: () => {
    incrementMetric("authority_cache_evicted");
  },
});

const shiftCache = new TtlCache<ShiftCached>({
  ttlMs: SHIFT_TTL_MS,
  maxEntries: MAX_ENTRIES_PER_CACHE,
  onEvict: (key) => {
    shiftInflight.delete(key);
  },
  onSetError: () => {
    incrementMetric("authority_cache_error_set");
  },
  onEvicted: () => {
    incrementMetric("authority_cache_evicted");
  },
});

// Phase 2.5 PR 7 — allowlist cache. Shares the existing TtlCache machinery and
// the same eviction/error hooks. Inflight map prevents the dogpile.
const allowlistInflight = new Map<string, Promise<AllowlistFetchResult>>();
const allowlistCache = new TtlCache<AllowlistCached>({
  ttlMs: ALLOWLIST_TTL_MS,
  maxEntries: MAX_ENTRIES_PER_CACHE,
  onEvict: (key) => {
    allowlistInflight.delete(key);
  },
  onSetError: () => {
    incrementMetric("authority_cache_error_set");
  },
  onEvicted: () => {
    incrementMetric("authority_cache_evicted");
  },
});

function checkInKey(clinicId: string, userId: string): string {
  return `${clinicId}:${userId}`;
}

function shiftKey(input: RoleResolutionInput, now: Date): string {
  const userId = input.userId?.trim() ?? "";
  const dayBucket = toLocalDateString(now);
  return `${input.clinicId}:${userId}:${input.fallbackRole}:${dayBucket}`;
}

// Phase 2.5 PR 7 — allowlist key invariant (§5.4): exactly (clinicId, userId).
// MUST NOT include operationalRole, route, snapshot fields, session ids, or
// any request-scoped dimension. Same shape as checkInKey by design — same
// (clinicId, userId) tuple, so the existing invalidateForUser hook clears
// both caches with a single call.
function allowlistKey(clinicId: string, userId: string): string {
  return `${clinicId}:${userId}`;
}

// ---------------------------------------------------------------------------
// Read-through wrappers.
// ---------------------------------------------------------------------------

export async function getOpenClinicalCheckInCached(
  input: GetOpenClinicalCheckInInput,
): Promise<OpenClinicalCheckInRow | null> {
  if (!isCacheEnabled()) {
    incrementMetric("authority_cache_disabled");
    return getOpenClinicalCheckIn(input);
  }

  const key = checkInKey(input.clinicId, input.userId);

  let cached: CheckInCached | null = null;
  try {
    cached = checkInCache.get(key);
  } catch {
    incrementMetric("authority_cache_error_get");
    cached = null;
  }
  if (cached === NONE) {
    incrementMetric("authority_cache_checkin_hit");
    return null;
  }
  if (cached) {
    incrementMetric("authority_cache_checkin_hit");
    return cached;
  }

  const existing = checkInInflight.get(key);
  if (existing) {
    incrementMetric("authority_cache_inflight_hit");
    return existing;
  }

  incrementMetric("authority_cache_checkin_miss");
  const epochAtStart = checkInCache.epochOf(key);

  const p = (async () => {
    const row = await getOpenClinicalCheckIn(input);
    if (checkInCache.epochOf(key) === epochAtStart) {
      checkInCache.set(key, row ?? NONE);
    } else {
      incrementMetric("authority_cache_stale_write_dropped");
    }
    return row;
  })();

  checkInInflight.set(key, p);
  try {
    return await p;
  } finally {
    checkInInflight.delete(key);
  }
}

export async function resolveCurrentRoleCached(
  input: RoleResolutionInput,
): Promise<RoleResolutionResult> {
  if (!isCacheEnabled()) {
    incrementMetric("authority_cache_disabled");
    return resolveCurrentRole(input);
  }

  const now = input.now ?? new Date();
  const userIdTrimmed = input.userId?.trim() ?? "";
  // Without a userId we cannot reliably canonicalize the name, so the cache
  // key would conflate distinct users. Short-circuit to the underlying call.
  if (!userIdTrimmed) {
    incrementMetric("authority_cache_disabled");
    return resolveCurrentRole(input);
  }

  const key = shiftKey(input, now);

  let cached: ShiftCached | null = null;
  try {
    cached = shiftCache.get(key);
  } catch {
    incrementMetric("authority_cache_error_get");
    cached = null;
  }
  if (cached === NONE) {
    incrementMetric("authority_cache_shift_hit");
    // Should be impossible because resolveCurrentRole never returns null —
    // documented for completeness alongside CheckInCache symmetry.
    return resolveCurrentRole(input);
  }
  if (cached) {
    incrementMetric("authority_cache_shift_hit");
    return cached;
  }

  const existing = shiftInflight.get(key);
  if (existing) {
    incrementMetric("authority_cache_inflight_hit");
    return existing;
  }

  incrementMetric("authority_cache_shift_miss");
  const epochAtStart = shiftCache.epochOf(key);

  const p = (async () => {
    const result = await resolveCurrentRole(input);
    if (shiftCache.epochOf(key) === epochAtStart) {
      shiftCache.set(key, result);
    } else {
      incrementMetric("authority_cache_stale_write_dropped");
    }
    return result;
  })();

  shiftInflight.set(key, p);
  try {
    return await p;
  } finally {
    shiftInflight.delete(key);
  }
}

/**
 * Phase 2.5 PR 7 — read-through wrapper for the (clinicId, userId) allowlist
 * fetched by `getAllowedOperationalRoles`. Used by the OPROLE enforcement
 * evaluator. Returns a discriminated result so the caller does not have to
 * re-implement the hit/miss/error categorization.
 *
 * When AUTHORITY_CACHE_V1 is not "true", falls through to the underlying DB
 * read with no Map touches (mirrors the other wrappers).
 *
 * Cache key (§5.4 invariant): exactly (clinicId, userId). NEVER includes
 * operationalRole, route, snapshot fields, session ids, or any request-scoped
 * dimension.
 */
export async function getAllowedOperationalRolesCached(
  input: { clinicId: string; userId: string },
): Promise<AllowlistFetchResult> {
  if (!isCacheEnabled()) {
    incrementMetric("authority_cache_disabled");
    try {
      const allowlist = await getAllowedOperationalRoles(
        input.userId,
        input.clinicId,
      );
      return {
        kind: "ok",
        allowlist: allowlist as readonly NonNullOperationalRole[],
      };
    } catch {
      incrementMetric("authority_cache_allowlist_error");
      return { kind: "error" };
    }
  }

  const key = allowlistKey(input.clinicId, input.userId);

  let cached: AllowlistCached | null = null;
  try {
    cached = allowlistCache.get(key);
  } catch {
    incrementMetric("authority_cache_error_get");
    cached = null;
  }
  if (cached) {
    incrementMetric("authority_cache_allowlist_hit");
    return { kind: "ok", allowlist: cached };
  }

  const existing = allowlistInflight.get(key);
  if (existing) {
    incrementMetric("authority_cache_inflight_hit");
    return existing;
  }

  incrementMetric("authority_cache_allowlist_miss");
  const epochAtStart = allowlistCache.epochOf(key);

  const p = (async (): Promise<AllowlistFetchResult> => {
    try {
      const allowlist = await getAllowedOperationalRoles(
        input.userId,
        input.clinicId,
      );
      const narrowed = allowlist as readonly NonNullOperationalRole[];
      if (allowlistCache.epochOf(key) === epochAtStart) {
        allowlistCache.set(key, narrowed);
      } else {
        incrementMetric("authority_cache_stale_write_dropped");
      }
      return { kind: "ok", allowlist: narrowed };
    } catch {
      // DB read failed. Do NOT cache; the next request retries.
      incrementMetric("authority_cache_allowlist_error");
      return { kind: "error" };
    }
  })();

  allowlistInflight.set(key, p);
  try {
    return await p;
  } finally {
    allowlistInflight.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Invalidation API. Writer-side hooks call these synchronously after their
// DB write succeeds.
// ---------------------------------------------------------------------------

export function invalidateForUser(clinicId: string, userId: string): void {
  try {
    const ckKey = checkInKey(clinicId, userId);
    // invalidate() bumps the epoch as part of its contract — any pending
    // inflight resolution that captured the pre-invalidate epoch will see a
    // mismatch and drop its stale write.
    checkInCache.invalidate(ckKey);
    checkInInflight.delete(ckKey);

    const shiftPrefix = `${clinicId}:${userId}:`;
    const matched = shiftCache.invalidatePrefix(shiftPrefix);
    for (const k of matched) {
      shiftInflight.delete(k);
    }
    if (matched.length > 0) {
      incrementMetric("authority_cache_invalidate_shift");
    }

    // Phase 2.5 PR 7 — extend invalidateForUser to cover the allowlist cache.
    // Existing user-mutation call sites (server/routes/users.ts:347/537/785/836)
    // pick this up automatically with zero edits there.
    const alKey = allowlistKey(clinicId, userId);
    allowlistCache.invalidate(alKey);
    allowlistInflight.delete(alKey);

    incrementMetric("authority_cache_invalidate_checkin");
    incrementMetric("authority_cache_invalidate_allowlist");
  } catch {
    incrementMetric("authority_cache_invalidate_error");
  }
}

export function invalidateClinicShift(clinicId: string): void {
  try {
    const matched = shiftCache.invalidatePrefix(`${clinicId}:`);
    for (const k of matched) {
      shiftInflight.delete(k);
    }
    incrementMetric("authority_cache_invalidate_clinic_shift");
  } catch {
    incrementMetric("authority_cache_invalidate_error");
  }
}

// ---------------------------------------------------------------------------
// Test-only helpers. Production code must not call these.
// ---------------------------------------------------------------------------

export function __resetAuthorityCacheForTests(): void {
  checkInCache.resetForTests();
  shiftCache.resetForTests();
  allowlistCache.resetForTests();
  checkInInflight.clear();
  shiftInflight.clear();
  allowlistInflight.clear();
}

export const __internals = {
  checkInCache,
  shiftCache,
  allowlistCache,
  checkInInflight,
  shiftInflight,
  checkInKey,
  shiftKey,
};
