/**
 * Phase 5 PR 5.5 — Clinical-invariant shadow-observability audit emitter.
 *
 * Ships the SAMPLED SHADOW emitter only:
 *
 *   - `emitClinicalInvariantShadowWouldHaveBlockedAudit(args)` — observes
 *     that the clinical-invariant evaluator detected orphan lines in
 *     shadow mode. Fire-and-forget post-commit; gated by
 *     `AUTHORITY_OBS_V1`; rate-limited to 1 per 5 min per
 *     `(clinicId, animalId)`.
 *
 * PR 5.5 deliberately ships NO enforce-mode emitters
 * (`clinical_invariant_orphan_dispense_denied`,
 * `clinical_invariant_emergency_bypass`, `clinical_invariant_fail_open`)
 * — those land in PR 5.7 with their corresponding audit kinds.
 *
 * Best-effort contract (Phase 5 plan §5 CI-25): a failure to insert
 * this audit row MUST NEVER affect verdict, counters, request
 * outcome, or trigger any retry. The emitter swallows internal
 * errors via try/catch around `logAudit`.
 *
 * Sibling-pattern: mirrors `stale-task-ownership.audit.ts` and
 * `task-assignment.audit.ts`. The clinical-invariant family has its
 * own rate-limiter bucket so its observability cannot starve or be
 * starved by other enforcement families (Phase 5 plan §4 doctrine 8).
 */

import { logAudit } from "../../audit.js";
import { createLogLimiter } from "../../log-safety.js";
import type {
  OrphanLineDetail,
  OrphanReasonCode,
} from "../../dispense-order-validation.js";

function isAuthorityObsV1Enabled(): boolean {
  return process.env.AUTHORITY_OBS_V1 === "true";
}

// Independent rate-limiter bucket. 5-minute window per the Phase 5
// plan §9.2 sampler spec for the shadow audit kind.
const shadowWouldHaveBlockedLimiter = createLogLimiter({
  dedupeWindowMs: 5 * 60_000,
  sampleRate: 1,
  maxEntries: 200,
});

export interface EmitClinicalInvariantShadowWouldHaveBlockedAuditInput {
  clinicId: string;
  animalId: string | null;
  containerId: string;
  requestId: string;
  /**
   * Orphan lines observed by the evaluator. The emitter computes
   * `reasonCodes` (the SET of distinct reasons across all lines —
   * §10.2 set-semantics cardinality contract) and `lineCount`
   * internally, so the two wiring sites never duplicate that logic
   * and the computation cannot diverge across them in future PRs.
   */
  orphanLines: ReadonlyArray<OrphanLineDetail>;
}

/**
 * Sampled shadow-mode emission. Gated by `AUTHORITY_OBS_V1`,
 * rate-limited per `(clinicId, animalId)`. Fire-and-forget — any
 * internal failure is swallowed.
 */
export function emitClinicalInvariantShadowWouldHaveBlockedAudit(
  args: EmitClinicalInvariantShadowWouldHaveBlockedAuditInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId) return;

  // Sampler key per Phase 5 plan §9.2 — `(clinicId, animalId)`. Null
  // animalId collapses to a stable placeholder so the sampler
  // continues to dedupe across requests with no patient link.
  const animalKey = args.animalId ?? "_no_animal";
  const key = `clinical_invariant_shadow_would_have_blocked:${args.clinicId}:${animalKey}`;
  if (!shadowWouldHaveBlockedLimiter.shouldLog(key)) return;

  // Compute reasonCodes (set semantics) + lineCount internally.
  // Centralising the extraction here removes the duplicated loops
  // the two wiring sites used to carry (Cursor Bugbot low-severity
  // review on PR 5.5) and guarantees the wiring sites cannot
  // diverge on cardinality semantics in future PRs.
  const seenReasons = new Set<OrphanReasonCode>();
  for (const line of args.orphanLines) {
    for (const reason of line.reasons) {
      seenReasons.add(reason);
    }
  }
  const reasonCodes = [...seenReasons];
  const lineCount = args.orphanLines.length;

  try {
    logAudit({
      clinicId: args.clinicId,
      actionType: "clinical_invariant_shadow_would_have_blocked",
      performedBy: "system:clinical_invariant_evaluator",
      performedByEmail: "",
      targetId: args.containerId,
      targetType: "container",
      metadata: {
        kind: "clinical_invariant_shadow",
        animalId: args.animalId,
        containerId: args.containerId,
        requestId: args.requestId,
        reasonCodes,
        lineCount,
      },
      actorRole: null,
    });
  } catch (err) {
    // Best-effort per CI-25 — never propagate. Log to server console
    // so operators can investigate, but the request path is
    // unaffected.
    console.error(
      "[clinical-invariant-audit] shadow-would-have-blocked emission failed",
      err,
    );
  }
}
