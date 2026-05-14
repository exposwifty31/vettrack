/**
 * Phase 2.5 PR 7 — operationalRole enforcement evaluator. ENFORCE-ONLY.
 *
 * Mode union: off | enforce (§4.1 / §5.3). NO PR-7 shadow mode. PR 5.3 owns
 * the OPROLE shadow signal via scheduleOperationalRoleShadowValidation and
 * its authority_oprole_shadow_* counters — duplicating it here would split
 * the signal.
 *
 * Cache: consumes server/lib/authority-cache.ts → getAllowedOperationalRolesCached.
 * Cache-key invariant (§5.4): exactly (clinicId, userId). NEVER includes
 * operationalRole, route, snapshot fields, session ids, or any request-scoped
 * dimension.
 *
 * Circuit breaker: reuses server/lib/circuit-breaker.ts under service key
 * "authority-oprole-cache". The existing module's hardcoded constants
 * (FAILURE_THRESHOLD = 5, OPEN_MS = 30_000) match the plan §6.4 contract.
 * PR 7 introduces NO new breaker state, NO new constants, NO parallel
 * Map<service, CircuitState>.
 *
 * Isolation: this file does NOT import stale.evaluator.ts. Enforced by
 * tests/authority-enforcement-import-isolation.test.ts.
 *
 * Drift prevention: on cache miss the wrapper calls
 * getAllowedOperationalRoles (which applies the OPERATIONAL_ROLE_SET filter).
 * The evaluator MUST go through the wrapper, never re-implement the jsonb
 * filter — check-in-time and use-time semantics must remain identical.
 */

import {
  getAllowedOperationalRolesCached,
  type AllowlistFetchResult,
} from "../../authority-cache.js";
import {
  isCircuitOpen,
  recordFailure,
  recordSuccess,
} from "../../circuit-breaker.js";
import { resolveOproleEnforcementMode } from "./config.js";
import { oproleEnforceMetrics } from "./metrics.js";
import { emitAuthorityEnforcementDenialAudit } from "./audit.js";
import type {
  EnforcementContext,
  EnforcementVerdict,
  OproleEnforcementMode,
} from "./result.js";

const OPROLE_CIRCUIT_SERVICE = "authority-oprole-cache";

/**
 * Test seam: callers can inject a fake allowlist fetcher with the same
 * AllowlistFetchResult shape. Production omits and uses the production wrapper.
 */
export type AllowlistFetcher = (
  input: { clinicId: string; userId: string },
) => Promise<AllowlistFetchResult>;

export interface EvaluateOpRoleEnforcementOptions {
  modeResolver?: (clinicId: string) => Promise<OproleEnforcementMode>;
  allowlistFetcher?: AllowlistFetcher;
}

export async function evaluateOpRoleEnforcement(
  ctx: EnforcementContext,
  options: EvaluateOpRoleEnforcementOptions = {},
): Promise<EnforcementVerdict> {
  const mode = await (options.modeResolver ?? resolveOproleEnforcementMode)(
    ctx.clinicId,
  );
  if (mode === "off") return { action: "allow" };

  // If the check-in row has no operationalRole, there is nothing to revalidate.
  const observed = ctx.checkIn.operationalRole;
  if (observed === null || observed === undefined) {
    return { action: "allow" };
  }

  // Circuit-breaker gate. If open, fail open: return allow without touching
  // the cache (§6.4). The existing circuit-breaker module increments
  // circuit_breaker_opened on transition to open — PR 7 does not double-count.
  if (isCircuitOpen(OPROLE_CIRCUIT_SERVICE)) {
    return { action: "allow" };
  }

  const fetcher = options.allowlistFetcher ?? getAllowedOperationalRolesCached;
  let result: AllowlistFetchResult;
  try {
    result = await fetcher({ clinicId: ctx.clinicId, userId: ctx.userId });
  } catch {
    // The wrapper itself should not throw (it catches internally and returns
    // { kind: "error" }), but defense-in-depth: a throw here is treated the
    // same as kind: "error".
    recordFailure(OPROLE_CIRCUIT_SERVICE);
    return { action: "allow" };
  }

  if (result.kind === "error") {
    recordFailure(OPROLE_CIRCUIT_SERVICE);
    return { action: "allow" };
  }

  recordSuccess(OPROLE_CIRCUIT_SERVICE);

  // Membership check. Drift prevention: the cached allowlist was produced by
  // getAllowedOperationalRoles which already applies OPERATIONAL_ROLE_SET
  // filtering — so check-in-time and use-time semantics are identical.
  const allowed = (result.allowlist as readonly string[]).includes(observed);
  if (allowed) {
    return { action: "allow" };
  }

  // mode === "enforce" — emit audit and deny.
  oproleEnforceMetrics.denied();
  emitAuthorityEnforcementDenialAudit({
    kind: "oprole",
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    reason: "CHECKED_IN_OPROLE_REVOKED",
    checkInId: ctx.checkIn.id,
    operationalRole: observed,
    resolvedAt: ctx.now.toISOString(),
    metadata: {
      allowlistSize: result.allowlist.length,
    },
  });

  return { action: "deny", reason: "CHECKED_IN_OPROLE_REVOKED" };
}
