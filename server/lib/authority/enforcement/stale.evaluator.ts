/**
 * Phase 2.5 PR 7 — Stale check-in enforcement evaluator.
 *
 * PURE function over (config, checkIn, now). NO DB. NO cache. NO writes. NO
 * invalidation. Side-effect invariant (§3.6): only counters, sampled logs, and
 * enforce-mode audit rows. Stale evaluator has no failure mode and no circuit
 * breaker — it cannot throw.
 *
 * Mode union: off | shadow | enforce (§4.1). Shadow returns "allow" and
 * increments authority_stale_would_have_denied. Enforce returns "deny" with
 * reason CHECKED_IN_STALE and emits one rate-limited audit row.
 *
 * Isolation: this file does NOT import oprole.evaluator.ts. Enforced by
 * tests/authority-enforcement-import-isolation.test.ts.
 *
 * Ceilings (§5.2):
 *   - 24h default
 *   - 36h when checkIn.operationalRole ∈ {night_admission_only, night_senior_no_admission}
 *   - both env-tunable via AUTHORITY_STALE_CEILING_HOURS / _NIGHT_HOURS
 *   - matches PR 5.2 sweeper's STALE_THRESHOLD_HOURS = 36 boundary
 */

import { createLogLimiter } from "../../log-safety.js";
import { resolveStaleEnforcementMode, getStaleCeilingMs } from "./config.js";
import type {
  EnforcementContext,
  EnforcementVerdict,
  StaleEnforcementMode,
} from "./result.js";
import { staleEnforceMetrics } from "./metrics.js";
import { emitAuthorityEnforcementDenialAudit } from "./audit.js";

// Sampled shadow-mode log line so on-call can see at least one example per
// (clinic, user) per 5 minutes when shadow rates spike during rollout.
const staleShadowLogLimiter = createLogLimiter({
  dedupeWindowMs: 300_000,
  sampleRate: 1,
  maxEntries: 500,
});

/**
 * Returns whether the check-in row is stale at `now`. Pure helper, exported
 * for unit testing without going through the full evaluator path.
 */
export function isStaleAt(args: {
  checkedInAt: Date | string | null | undefined;
  operationalRole: string | null;
  now: Date;
}): boolean {
  const checkedInAt = args.checkedInAt;
  if (!checkedInAt) return false;

  const checkedInMs =
    checkedInAt instanceof Date
      ? checkedInAt.getTime()
      : Date.parse(String(checkedInAt));
  if (!Number.isFinite(checkedInMs)) return false;

  const ceilingMs = getStaleCeilingMs(args.operationalRole);
  return args.now.getTime() - checkedInMs > ceilingMs;
}

/**
 * Evaluator. Takes the enforcement context plus an optional injected mode
 * resolver for unit tests; production callers omit the second arg and use the
 * env-backed resolver.
 */
export async function evaluateStaleEnforcement(
  ctx: EnforcementContext,
  modeResolver?: (clinicId: string) => Promise<StaleEnforcementMode>,
): Promise<EnforcementVerdict> {
  const mode = await (modeResolver ?? resolveStaleEnforcementMode)(ctx.clinicId);
  if (mode === "off") return { action: "allow" };

  const checkedInAtRaw = (ctx.checkIn as { checkedInAt?: Date | string | null })
    .checkedInAt;
  const stale = isStaleAt({
    checkedInAt: checkedInAtRaw ?? null,
    operationalRole: ctx.checkIn.operationalRole,
    now: ctx.now,
  });

  if (!stale) return { action: "allow" };

  if (mode === "shadow") {
    staleEnforceMetrics.wouldHaveDenied();
    const key = `stale-shadow:${ctx.clinicId}:${ctx.userId}`;
    if (staleShadowLogLimiter.shouldLog(key)) {
      console.warn(
        "[authority-stale-shadow]",
        JSON.stringify({
          event: "stale_would_have_denied",
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          checkInId: ctx.checkIn.id,
          operationalRole: ctx.checkIn.operationalRole,
          now: ctx.now.toISOString(),
        }),
      );
    }
    return { action: "allow" };
  }

  // mode === "enforce"
  staleEnforceMetrics.denied();
  emitAuthorityEnforcementDenialAudit({
    kind: "stale",
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    reason: "CHECKED_IN_STALE",
    checkInId: ctx.checkIn.id,
    operationalRole: ctx.checkIn.operationalRole,
    resolvedAt: ctx.now.toISOString(),
    metadata: {
      ceilingMs: getStaleCeilingMs(ctx.checkIn.operationalRole),
      checkedInAt:
        checkedInAtRaw instanceof Date
          ? checkedInAtRaw.toISOString()
          : (checkedInAtRaw ?? null),
    },
  });

  return { action: "deny", reason: "CHECKED_IN_STALE" };
}
