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
import type { StaleTaskOwnershipEnforcementMode } from "./stale-task-ownership.types.js";
import type {
  CodeBlueManagerEndpoint,
  CodeBlueManagerEnforcementMode,
} from "./code-blue-manager.types.js";

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
// Phase 3 PR 3.6 — stale-task-ownership evaluator flag. Independent cache;
// the family shares nothing observable with task-assignment, PR 7 stale,
// or PR 7 oprole resolution paths.
const staleTaskOwnershipCache = new Map<string, CacheEntry<StaleTaskOwnershipEnforcementMode>>();
// Phase 4 PR 4.1 — Code Blue manager authority enforcement flag. Independent
// cache. Cache key includes the per-endpoint sub-key so `initiation` and `end`
// resolve independently per clinic. The cache TTL is shared with the other
// families (10s), matching the rollback contract in master plan §11.
const codeBlueManagerCache = new Map<string, CacheEntry<CodeBlueManagerEnforcementMode>>();
// Phase 4 PR 4.4b — drug/shock actor authority enforcement flag.
// Independent cache, single sub-key per clinic (no endpoint sub-key — this
// is per-route, not per-endpoint).
type CodeBlueLogDrugShockMode = "off" | "shadow" | "enforce";
const codeBlueLogDrugShockCache = new Map<string, CacheEntry<CodeBlueLogDrugShockMode>>();

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

/**
 * Phase 3 PR 3.6 — Stale-task-ownership evaluator mode resolver.
 *
 * Same resolution chain as the task-assignment family: per-clinic
 * vt_server_config override (`authority.stale_task_ownership_enforce.<clinicId>`)
 * → env default (`AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1`) → `"off"`.
 *
 * Accepts `off | shadow | enforce`. Anything else collapses to `off`.
 */
function isStaleTaskOwnershipMode(
  value: string | null | undefined,
): value is StaleTaskOwnershipEnforcementMode {
  return value === "off" || value === "shadow" || value === "enforce";
}

export async function resolveStaleTaskOwnershipEnforcementMode(
  clinicId: string,
): Promise<StaleTaskOwnershipEnforcementMode> {
  const cached = readCache(staleTaskOwnershipCache, clinicId);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `authority.stale_task_ownership_enforce.${clinicId}`,
    );
  } catch {
    override = null;
  }
  if (isStaleTaskOwnershipMode(override)) {
    writeCache(staleTaskOwnershipCache, clinicId, override);
    return override;
  }

  const envDefault = process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1;
  const resolved: StaleTaskOwnershipEnforcementMode = isStaleTaskOwnershipMode(envDefault)
    ? envDefault
    : "off";
  writeCache(staleTaskOwnershipCache, clinicId, resolved);
  return resolved;
}

/**
 * Phase 4 PR 4.1 — Code Blue manager authority enforcement mode resolver.
 *
 * Per-endpoint sub-key (`initiation` | `end`) — each Code Blue endpoint
 * resolves independently per clinic so an operator can shadow `initiation`
 * while keeping `end` at `off` (or any combination). The endpoint participates
 * in the per-clinic vt_server_config key path AND the per-process cache key.
 *
 * Resolution chain (matches PR 7 / PR 3.3 / PR 3.6):
 *   per-clinic vt_server_config (`code_blue.manager_enforce.<clinicId>.<endpoint>`)
 *   → env default (`AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1`)
 *   → `"off"`.
 *
 * Accepts `off | shadow | enforce`. Anything else collapses to `off` so a
 * typo cannot silently activate enforcement (typo-defensive).
 *
 * Env defaults remain conservative (`off`) per Phase 4 master plan §11.
 * PR 4.5 enables enforcement clinic-by-clinic via vt_server_config; PR 4.5
 * does NOT flip the env default.
 */
function isCodeBlueManagerMode(
  value: string | null | undefined,
): value is CodeBlueManagerEnforcementMode {
  return value === "off" || value === "shadow" || value === "enforce";
}

export async function resolveCodeBlueManagerEnforcementMode(
  clinicId: string,
  endpoint: CodeBlueManagerEndpoint,
): Promise<CodeBlueManagerEnforcementMode> {
  const cacheKey = `${clinicId}:${endpoint}`;
  const cached = readCache(codeBlueManagerCache, cacheKey);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `code_blue.manager_enforce.${clinicId}.${endpoint}`,
    );
  } catch {
    override = null;
  }
  if (isCodeBlueManagerMode(override)) {
    writeCache(codeBlueManagerCache, cacheKey, override);
    return override;
  }

  const envDefault = process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
  const resolved: CodeBlueManagerEnforcementMode = isCodeBlueManagerMode(envDefault)
    ? envDefault
    : "off";
  writeCache(codeBlueManagerCache, cacheKey, resolved);
  return resolved;
}

/**
 * Phase 4 PR 4.4b — Drug/shock actor authority enforcement mode resolver.
 *
 * Per-route flag (no endpoint sub-key — distinct from the manager family
 * which has separate initiation/end sub-keys). Governs the actor-snapshot
 * oprole shadow check on POST /api/code-blue/sessions/:id/logs for
 * category ∈ {drug, shock}.
 *
 * Resolution chain (matches PR 4.1 manager pattern):
 *   per-clinic vt_server_config (`code_blue.log_drug_shock_enforce.<clinicId>`)
 *   → env default (`AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1`)
 *   → `"off"`.
 *
 * Env defaults remain conservative (`off`) per master plan §11. PR 4.5
 * enables enforcement clinic-by-clinic via vt_server_config; PR 4.5 does
 * NOT flip the env default.
 */
function isCodeBlueLogDrugShockMode(
  value: string | null | undefined,
): value is CodeBlueLogDrugShockMode {
  return value === "off" || value === "shadow" || value === "enforce";
}

export async function resolveCodeBlueLogDrugShockEnforcementMode(
  clinicId: string,
): Promise<CodeBlueLogDrugShockMode> {
  const cached = readCache(codeBlueLogDrugShockCache, clinicId);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `code_blue.log_drug_shock_enforce.${clinicId}`,
    );
  } catch {
    override = null;
  }
  if (isCodeBlueLogDrugShockMode(override)) {
    writeCache(codeBlueLogDrugShockCache, clinicId, override);
    return override;
  }

  const envDefault = process.env.AUTHORITY_CODE_BLUE_LOG_DRUG_SHOCK_ENFORCE_V1;
  const resolved: CodeBlueLogDrugShockMode = isCodeBlueLogDrugShockMode(envDefault)
    ? envDefault
    : "off";
  writeCache(codeBlueLogDrugShockCache, clinicId, resolved);
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
  staleTaskOwnershipCache.clear();
  codeBlueManagerCache.clear();
  codeBlueLogDrugShockCache.clear();
}

export const __testInternals = {
  PER_CLINIC_TTL_MS,
  STALE_DEFAULT_HOURS,
  STALE_NIGHT_HOURS,
};
