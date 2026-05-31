/**
 * Phase 2.5 PR 7 — Authority enforcement durable audit emission.
 *
 * Mirrors the pattern in server/lib/authority-audit.ts:
 *   - gated by AUTHORITY_OBS_V1 (same flag as existing PR 5 audit emission)
 *   - fire-and-forget via logAudit
 *   - rate-limited per (kind, clinicId, userId) via createLogLimiter
 *   - independent buckets per kind so stale and OPROLE denials cannot
 *     starve each other
 *
 * Plan deviation: the rate-limit key is (kind, clinicId, userId), NOT
 * (kind, clinicId, userId, route) as written in plan §7.2. The evaluator
 * runs inside the resolver and does not have access to the Express request.
 * Adding route to the key would require a middleware edit (forbidden by
 * hard constraints) or passing route through the resolver signature (a
 * larger refactor). One row per (kind, clinicId, userId) per 60s is
 * sufficient observability for the enforce-mode signal — volume is
 * additionally covered by the always-on counters in metrics.ts.
 *
 * Shadow mode never writes a row (plan §7.1). Only enforce-mode denials
 * call this emitter.
 */

import { isAuthorityObsV1Enabled } from "../../authority-audit.js";
import { logAudit } from "../../audit.js";
import { createLogLimiter } from "../../log-safety.js";

export type EnforcementDenialKind = "stale" | "oprole";

// Two independent buckets so stale and OPROLE denials cannot starve each
// other. 60s dedupe window matches the existing emitAuthorityDeniedAudit
// limiter.
const staleAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

const oproleAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

export interface AuthorityEnforcementDenialAuditInput {
  kind: EnforcementDenialKind;
  clinicId: string;
  userId: string;
  /** Snapshot reason emitted to the middleware. */
  reason: "CHECKED_IN_STALE" | "CHECKED_IN_OPROLE_REVOKED";
  /** Check-in row id involved in the denial (for traceability). */
  checkInId: string;
  /** Check-in row's operationalRole at check-in time, if any. */
  operationalRole: string | null;
  /** ISO timestamp of the resolution that produced the denial. */
  resolvedAt: string;
  /** Optional per-kind metadata (e.g. ceilingMs, checkedInAt for stale). */
  metadata?: Record<string, unknown>;
}

export function emitAuthorityEnforcementDenialAudit(
  args: AuthorityEnforcementDenialAuditInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId || !args.userId) return;

  const limiter = args.kind === "stale" ? staleAuditLimiter : oproleAuditLimiter;
  const key = `${args.kind}:${args.clinicId}:${args.userId}`;
  if (!limiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId: args.clinicId,
      actionType:
        args.kind === "stale"
          ? "authority_enforcement_denied_stale"
          : "authority_enforcement_denied_oprole",
      performedBy: args.userId,
      // logAudit signature requires string; email is not available inside the
      // resolver (no req). Empty-string sentinel matches the "unknown" idiom
      // used by emitAuthorityDeniedAudit when authUser.email is absent.
      performedByEmail: "",
      targetId: args.checkInId,
      targetType: "authority_decision",
      metadata: {
        kind: args.kind,
        reason: args.reason,
        operationalRole: args.operationalRole,
        resolvedAt: args.resolvedAt,
        ...(args.metadata ?? {}),
      },
      actorRole: null,
    });
  } catch (err) {
    // logAudit is already fire-and-forget; this catch is defense-in-depth.
    console.error("[authority-enforcement-audit] emission failed", err);
  }
}
