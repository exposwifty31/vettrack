/**
 * Phase 5 PR 5.1 — Clinical-invariant enforcement mode resolver.
 *
 * Per Phase 5 master plan §19.16 (config file co-location), the
 * resolver lives in its OWN file rather than being appended to
 * `config.ts`. This keeps the Phase 2.5 / Phase 3 / Phase 4 resolver
 * bodies in `config.ts` frozen and prevents cross-family coupling
 * through shared cache state.
 *
 * Resolution chain (mirrors PR 7 stale / PR 3.3 task-assignment /
 * PR 3.6 stale-task-ownership / PR 4.1 Code Blue manager — plan §3.1
 * architectural inheritance):
 *
 *   per-clinic vt_server_config (`cop.clinical_invariant_enforce.<clinicId>`)
 *   → env default (`COP_CLINICAL_INVARIANT_ENFORCE_V1`)
 *   → `"off"`.
 *
 * Accepts `off | shadow | enforce`. Anything else collapses to `off`
 * so a typo cannot silently activate enforcement (typo-defensive).
 *
 * 10s in-process TTL on per-clinic reads matches Phase 5 plan §19.4
 * (rollback window contract): flips become visible within one TTL
 * window. Independent cache map per Phase 5 plan §19.16.
 *
 * Env default remains conservative (`off`) per plan §19.3 — no
 * global enforce default is ever introduced inside Phase 5.
 *
 * vt_server_config has NO clinic column at the schema level; clinic
 * isolation is achieved by embedding clinicId into the key string.
 * The first parameter of getServerConfigValue is currently unused,
 * matching the convention in `config.ts`.
 */

import { getServerConfigValue } from "../../server-config.js";
import type { ClinicalInvariantEnforcementMode } from "./clinical-invariant.types.js";

// ---------------------------------------------------------------------------
// Per-clinic config TTL — rollback contract (plan §19.4): flips become
// visible within this window. Matches every prior enforcement family.
// ---------------------------------------------------------------------------

const PER_CLINIC_TTL_MS = 10_000;

interface CacheEntry {
  value: ClinicalInvariantEnforcementMode;
  expiresAt: number;
}

// Independent cache map — Phase 5 plan §19.16. Stale, oprole,
// task-assignment, stale-task-ownership, and Code Blue manager
// families each own their own cache map in `config.ts`. The
// clinical-invariant family is operationally co-located but
// architecturally distinct (CI-14), so it owns its own map here.
const clinicalInvariantCache = new Map<string, CacheEntry>();

function readCache(key: string): ClinicalInvariantEnforcementMode | null {
  const entry = clinicalInvariantCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    clinicalInvariantCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: ClinicalInvariantEnforcementMode): void {
  clinicalInvariantCache.set(key, {
    value,
    expiresAt: Date.now() + PER_CLINIC_TTL_MS,
  });
}

function isClinicalInvariantMode(
  value: string | null | undefined,
): value is ClinicalInvariantEnforcementMode {
  return value === "off" || value === "shadow" || value === "enforce";
}

/**
 * Resolve the per-clinic clinical-invariant enforcement mode.
 *
 * Mirrors the resolution chain of every prior enforcement family.
 * Off-by-default per Phase 5 plan §19.3. Returns within ~10s of a
 * `vt_server_config` flip per the rollback contract (plan §11).
 *
 * Strategy A: a `getServerConfigValue` throw is treated as "no
 * override" — the env default and ultimate "off" fall-through apply.
 * The throw is silently swallowed here so that callers (Phase 5
 * PR 5.3 / 5.4 wiring) do not need to wrap this in try/catch a
 * second time. The wiring layer additionally catches any unexpected
 * throw at the call site (plan §15 PR 5.3 wiring Strategy A safety
 * net — defense in depth).
 */
export async function resolveClinicalInvariantEnforcementMode(
  clinicId: string,
): Promise<ClinicalInvariantEnforcementMode> {
  const cached = readCache(clinicId);
  if (cached !== null) return cached;

  let override: string | null = null;
  try {
    override = await getServerConfigValue(
      clinicId,
      `cop.clinical_invariant_enforce.${clinicId}`,
    );
  } catch {
    override = null;
  }
  if (isClinicalInvariantMode(override)) {
    writeCache(clinicId, override);
    return override;
  }

  const envDefault = process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
  const resolved: ClinicalInvariantEnforcementMode = isClinicalInvariantMode(envDefault)
    ? envDefault
    : "off";
  writeCache(clinicId, resolved);
  return resolved;
}

// ---------------------------------------------------------------------------
// Test-only escape hatch. Production code must not call this.
// Matches the pattern in `config.ts` (`__resetEnforcementConfigCacheForTests`).
// ---------------------------------------------------------------------------

export function __resetClinicalInvariantConfigCacheForTests(): void {
  clinicalInvariantCache.clear();
}

export const __testInternals = {
  PER_CLINIC_TTL_MS,
};
