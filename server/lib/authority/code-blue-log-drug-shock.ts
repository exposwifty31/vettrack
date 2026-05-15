/**
 * Phase 4 PR 4.4b — Drug/shock actor oprole shadow detection.
 *
 * Called from POST /api/code-blue/sessions/:id/logs ONLY for log entries
 * with category ∈ {drug, shock}. Inspects the REQUEST ACTOR's own snapshot
 * (already attached by `requireClinicalAuthority` middleware, PR 4.4a) and
 * shadow-emits when the actor's operational role is not in the Code-Blue
 * allowlist.
 *
 * This is the one place in Phase 4 where the actor's snapshot is the right
 * input — drug/shock administration is a clinical action performed by the
 * request actor themselves, not by the persisted manager. Master plan §8
 * locks this: "drug/shock additionally pass an oprole-shadow check
 * requiring vet authority" on the actor's snapshot.
 *
 * Reuses the FROZEN PR 4.1 pure predicate (`computeCodeBlueManagerSnapshotDeny`)
 * — same allowlist (DECISION-1), same predicate, different audit/metric
 * family. Does NOT invoke `evaluateCodeBlueManagerAuthority` (would emit
 * the wrong family — `code_blue_manager_authority_*` instead of
 * `code_blue_log_drug_shock_*`).
 *
 * Defensive contract: helper internally catches all errors and never
 * throws. Shadow-only in PR 4.4b — never blocks the log write. PR 4.5
 * wires enforce-mode 403 separately.
 */

import type { AuthoritySnapshot } from "../../../shared/authority.js";
import { logAudit, type AuditActionType } from "../audit.js";
import { createLogLimiter } from "../log-safety.js";
import { incrementMetric } from "../metrics.js";
import { resolveCodeBlueLogDrugShockEnforcementMode } from "./enforcement/config.js";
import { computeCodeBlueManagerSnapshotDeny } from "./enforcement/code-blue-manager.evaluator.js";
import type { CodeBlueManagerDenyReason } from "./enforcement/code-blue-manager.types.js";

const DRUG_SHOCK_SHADOW_AUDIT_KIND: AuditActionType =
  "code_blue_log_drug_shock_authority_shadow_denied";

// Independent rate-limiter bucket (60s dedupe window) — mirrors PR 4.1 +
// PR 4.4a discipline. Without this, an actor recording rapid drug pushes
// would emit one audit row per push.
const drugShockShadowAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

function isAuthorityObsV1Enabled(): boolean {
  return process.env.AUTHORITY_OBS_V1 === "true";
}

function actorShadowDeniedCounterForReason(
  reason: CodeBlueManagerDenyReason,
): string | null {
  switch (reason) {
    case "OPROLE_NOT_IN_CB_ALLOWLIST":
      return "code_blue_log_drug_shock_actor_authority_shadow_denied_oprole_not_in_allowlist";
    case "NO_OPEN_CHECK_IN":
      return "code_blue_log_drug_shock_actor_authority_shadow_denied_no_open_check_in";
    // The snapshot-only predicate cannot return MANAGER_CROSS_CLINIC or
    // USER_MISSING — those come from the wiring helper's DB lookup, which
    // this code path does not use (the actor's snapshot is already attached
    // by middleware). Silently ignore for forward compatibility.
    case "MANAGER_CROSS_CLINIC":
    case "USER_MISSING":
      return null;
  }
}

export type CodeBlueLogDrugShockCategory = "drug" | "shock";

export interface DetectDrugShockActorDriftInput {
  clinicId: string;
  sessionId: string;
  /**
   * The actor's authority snapshot, set by `requireClinicalAuthority`
   * middleware (PR 4.4a). May be null/undefined if the middleware ever
   * passes without setting it (defensive — the helper no-ops in that case).
   */
  snapshot: AuthoritySnapshot | null | undefined;
  actorUserId: string;
  actorEmail?: string;
  category: CodeBlueLogDrugShockCategory;
  now?: Date;
}

/**
 * Inspect the actor's own snapshot against the Code-Blue allowlist for
 * drug/shock log writes. Shadow-only in PR 4.4b: emits audit + metric,
 * never blocks. Never throws.
 *
 * Returns void. PR 4.5 will add a separate enforce-mode wrapper that can
 * translate the same observation into a 403 BEFORE the log insert.
 */
export async function detectDrugShockActorDrift(
  input: DetectDrugShockActorDriftInput,
): Promise<void> {
  try {
    // Mode resolution happens FIRST so an `off`-mode clinic incurs zero
    // observation cost. Per-clinic vt_server_config override → env default
    // → `"off"`. Same resolution chain as every other Phase 4 mode flag.
    const mode = await resolveCodeBlueLogDrugShockEnforcementMode(input.clinicId);
    if (mode === "off") return;

    if (!input.snapshot) {
      // Defensive: middleware should have set the snapshot. If it's missing,
      // we can't make any signal. No counter, no audit, no throw.
      return;
    }

    const result = computeCodeBlueManagerSnapshotDeny(input.snapshot);

    if (result.kind === "mode_inactive") {
      incrementMetric(
        "code_blue_log_drug_shock_actor_authority_mode_inactive_strategy_a",
      );
      return;
    }

    if (result.kind === "allow") {
      incrementMetric("code_blue_log_drug_shock_actor_authority_allow");
      return;
    }

    // result.kind === "deny"
    const reason = result.reason;
    const counterName = actorShadowDeniedCounterForReason(reason);
    if (counterName === null) return;

    incrementMetric(counterName);

    // In PR 4.4b only shadow mode emits the audit. PR 4.5 will introduce
    // a distinct `code_blue_log_drug_shock_authority_denied` kind for
    // enforce-mode 403s — that's a separate audit family with its own
    // counter and code path, not this one.
    if (mode !== "shadow") return;

    if (!isAuthorityObsV1Enabled()) return;
    if (!input.clinicId || !input.actorUserId) return;

    const limiterKey = `drug_shock_shadow:${input.clinicId}:${input.sessionId}:${input.actorUserId}:${reason}`;
    if (!drugShockShadowAuditLimiter.shouldLog(limiterKey)) return;

    const now = input.now ?? new Date();
    logAudit({
      clinicId: input.clinicId,
      actionType: DRUG_SHOCK_SHADOW_AUDIT_KIND,
      performedBy: input.actorUserId,
      performedByEmail: input.actorEmail ?? "",
      targetId: input.sessionId,
      targetType: "code_blue_log_drug_shock_authority_decision",
      metadata: {
        kind: "drug_shock_shadow_denied",
        reason,
        sessionId: input.sessionId,
        category: input.category,
        actorUserId: input.actorUserId,
        resolvedAt: now.toISOString(),
        severity: "info",
      },
      actorRole: null,
    });
  } catch (err) {
    // Never block the log write under any dependency failure.
    console.error(
      "[code-blue] drug/shock actor-drift detection failed (shadow); log write continues",
      err,
    );
  }
}
