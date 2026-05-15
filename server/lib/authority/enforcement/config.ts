/**
 * Phase 2.5 PR 7 — Authority enforcement configuration.
 *
 * Owns:
 *   - Flag resolution chain: per-clinic vt_server_config override → env default → "off".
 *   - 10s in-process TTL on per-clinic reads (§4.1) so flips become visible
 *     within one TTL window (rollback contract §4.5).
 *   - Stale ceiling env constants (24h day / 36h night, sweeper-aligned).
 *
 * Carries NO circuit-breaker constants — PR 7 reuses server/lib/circuit-breaker.ts
 * unchanged (§6.4). Carries NO authority-cache TTL — that lives in authority-cache.ts.
 *
 * Per-clinic config keys (§4.1):
 *   - authority.stale_enforce.<clinicId>
 *   - authority.oprole_enforce.<clinicId>
 *
 * vt_server_config has NO clinic column at the schema level; clinic isolation
 * is achieved by embedding clinicId into the key string. The first parameter
 * of getServerConfigValue is currently unused — confirmed during preflight.
 */

import { getServerConfigValue } from "../../server-config.js";
import type {
  OproleEnforcementMode,
  StaleEnforcementMode,
  TaskAssignmentEnforcementMode,
} from "./result.js";

// ---------------------------------------------------------------------------
// Per-clinic config TTL (rollback contract: flips visible within this window).
// ---------------------------------------------------------------------------

const PER_CLINIC_TTL_MS = 10_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// One Map per flag family so the families are observably independent. Failure
// to read any one does not affect the others.
const staleCache = new Map<string, CacheEntry<StaleEnforcementMode>>();
const oproleCache = new Map<string, CacheEntry<OproleEnforcementMode>>();
// Phase 3 PR 3.3 — task-assignment evaluator flag. Independent cache so
// stale/oprole resolution paths cannot affect this family and vice versa.
const taskAssignmentCache = new Map<string, CacheEntry<TaskAssignmentEnforcementMode>>();

function readCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + PER_CLINIC_TTL_MS });
}

// ---------------------------------------------------------------------------
// Stale ceilings (sweeper-aligned defaults; env-tunable per plan §5.2).
// ---------------------------------------------------------------------------

const STALE_DEFAULT_HOURS = 24;
const STALE_NIGHT_HOURS = 36;

/**
 * Returns the configured stale ceiling in milliseconds, given the check-in's
 * operationalRole at check-in time. Night roles get the longer ceiling.
 */
export function getStaleCeilingMs(operationalRole: string | null): number {
  const isNight =
    operationalRole === "night_admission_only" ||
    operationalRole === "night_senior_no_admission";

  const envKey = isNight
    ? "AUTHORITY_STALE_CEILING_NIGHT_HOURS"
    : "AUTHORITY_STALE_CEILING_HOURS";
  const fallback = isNight ? STALE_NIGHT_HOURS : STALE_DEFAULT_HOURS;

  const raw = process.env[envKey];
  if (raw) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed * 60 * 60 * 1000);
    }
  }
  return fallback * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Flag resolution: per-clinic override → env default → "off".
// ---------------------------------------------------------------------------

function isStaleMode(value: string | null | undefined): value is StaleEnforcementMode {
  return value === "off" || value === "shadow" || value === "enforce";
}

function isOproleMode(value: string | null | undefined): value is OproleEnforcementMode {
  // OPROLE has no shadow mode in PR 7 (§4.1 / §5.3). "shadow" values from
  // mis-configuration collapse to "off" so a typo does not accidentally
  // duplicate the PR 5.3 shadow signal.
  return value === "off" || value === "enforce";
}

export async function resolveStaleEnforcementMode(
  clinicId: string,
): Promise<StaleEnforcementMode> {
  const cached = readCache(staleCache, clinicId);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `authority.stale_enforce.${clinicId}`,
    );
  } catch {
    override = null;
  }
  if (isStaleMode(override)) {
    writeCache(staleCache, clinicId, override);
    return override;
  }

  const envDefault = process.env.AUTHORITY_STALE_ENFORCE_V1;
  const resolved: StaleEnforcementMode = isStaleMode(envDefault) ? envDefault : "off";
  writeCache(staleCache, clinicId, resolved);
  return resolved;
}

/**
 * Phase 3 PR 3.3 — Task-assignment evaluator mode resolver.
 *
 * Same resolution chain as stale/oprole: per-clinic vt_server_config override
 * (`authority.task_assignment_enforce.<clinicId>`) → env default
 * (`AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1`) → `"off"`.
 *
 * Accepts `off | shadow | enforce`. Anything else collapses to `off` so a
 * typo cannot silently activate the evaluator.
 */
function isTaskAssignmentMode(
  value: string | null | undefined,
): value is TaskAssignmentEnforcementMode {
  return value === "off" || value === "shadow" || value === "enforce";
}

export async function resolveTaskAssignmentEnforcementMode(
  clinicId: string,
): Promise<TaskAssignmentEnforcementMode> {
  const cached = readCache(taskAssignmentCache, clinicId);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `authority.task_assignment_enforce.${clinicId}`,
    );
  } catch {
    override = null;
  }
  if (isTaskAssignmentMode(override)) {
    writeCache(taskAssignmentCache, clinicId, override);
    return override;
  }

  const envDefault = process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1;
  const resolved: TaskAssignmentEnforcementMode = isTaskAssignmentMode(envDefault)
    ? envDefault
    : "off";
  writeCache(taskAssignmentCache, clinicId, resolved);
  return resolved;
}

export async function resolveOproleEnforcementMode(
  clinicId: string,
): Promise<OproleEnforcementMode> {
  const cached = readCache(oproleCache, clinicId);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `authority.oprole_enforce.${clinicId}`,
    );
  } catch {
    override = null;
  }
  if (isOproleMode(override)) {
    writeCache(oproleCache, clinicId, override);
    return override;
  }

  const envDefault = process.env.AUTHORITY_OPROLE_ENFORCE_V1;
  const resolved: OproleEnforcementMode = isOproleMode(envDefault) ? envDefault : "off";
  writeCache(oproleCache, clinicId, resolved);
  return resolved;
}

// ---------------------------------------------------------------------------
// Test-only escape hatch. Production code must not call this.
// ---------------------------------------------------------------------------

export function __resetEnforcementConfigCacheForTests(): void {
  staleCache.clear();
  oproleCache.clear();
  taskAssignmentCache.clear();
}

export const __testInternals = {
  PER_CLINIC_TTL_MS,
  STALE_DEFAULT_HOURS,
  STALE_NIGHT_HOURS,
};
