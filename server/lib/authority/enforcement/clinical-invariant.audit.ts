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

import { logAudit, type AuditDbExecutor } from "../../audit.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 PR 5.7 — enforce-side audit emitters
// ─────────────────────────────────────────────────────────────────────────────

// Independent rate-limiter bucket per Phase 5 plan §9.2:
//   `clinical_invariant_orphan_dispense_denied` — 60s dedupe key
//   `(clinicId, animalId, containerId)`, max 500 entries.
const orphanDispenseDeniedLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

// `clinical_invariant_emergency_bypass` — 60s dedupe key
// `(clinicId, userId, containerId)`, max 500 entries.
const emergencyBypassLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

// `clinical_invariant_fail_open` — 60s dedupe key `(clinicId, route)`,
// max 200 entries.
const failOpenLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 200,
});

export interface EmitClinicalInvariantOrphanDispenseDeniedAuditInput {
  clinicId: string;
  animalId: string | null;
  containerId: string;
  requestId: string;
  /**
   * Orphan lines from the deny verdict. The emitter computes
   * `reasonCodes` (set semantics) + `lineCount` internally so the
   * wiring sites stay symmetric (same pattern as the shadow emitter).
   */
  orphanLines: ReadonlyArray<OrphanLineDetail>;
}

/**
 * Phase 5 PR 5.7 — enforce-mode denial audit.
 *
 * Attempted **inside** the rolled-back transaction (`AuditDbExecutor`
 * required). Per CI-26 / §9.4 the row is best-effort and NOT durable
 * — the tx that produces the deny verdict rolls back the audit row
 * alongside the mutation. Durable observability for denied attempts
 * is the metric counters + 422 response + server logs. The ordering
 * contract (audit attempt BEFORE the 422 response is sent) is
 * verified by the dedicated PR 5.7.1 regression test.
 *
 * Gated by `AUTHORITY_OBS_V1`. Rate-limited per
 * `(clinicId, animalId, containerId)` per 60s.
 *
 * Internal failures are swallowed (best-effort observability).
 */
export async function emitClinicalInvariantOrphanDispenseDeniedAuditInTx(
  tx: AuditDbExecutor,
  args: EmitClinicalInvariantOrphanDispenseDeniedAuditInput,
): Promise<void> {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId) return;

  const animalKey = args.animalId ?? "_no_animal";
  const key = `clinical_invariant_orphan_dispense_denied:${args.clinicId}:${animalKey}:${args.containerId}`;
  if (!orphanDispenseDeniedLimiter.shouldLog(key)) return;

  const seenReasons = new Set<OrphanReasonCode>();
  for (const line of args.orphanLines) {
    for (const reason of line.reasons) {
      seenReasons.add(reason);
    }
  }
  const reasonCodes = [...seenReasons];
  const lineCount = args.orphanLines.length;

  // Phase 5 PR 5.7 (post-merge review fix — Codex P1 + Cursor): the
  // `logAudit({ tx, … })` overload returns `Promise<void>`. Previously
  // we discarded that promise, which (a) violated the §9.4 ordering
  // contract because the in-tx INSERT raced the deny throw, and (b)
  // allowed async rejections to escape this try/catch and surface as
  // unhandled promise rejections (process-fatal under Node 15+ strict
  // mode). Awaiting binds the INSERT attempt to the call site and
  // routes any rejection through the documented best-effort
  // swallow path.
  try {
    await logAudit({
      tx,
      clinicId: args.clinicId,
      actionType: "clinical_invariant_orphan_dispense_denied",
      performedBy: "system:clinical_invariant_evaluator",
      performedByEmail: "",
      targetId: args.containerId,
      targetType: "container",
      metadata: {
        kind: "clinical_invariant_orphan_dispense_denied",
        animalId: args.animalId,
        containerId: args.containerId,
        requestId: args.requestId,
        reasonCodes,
        lineCount,
      },
      actorRole: null,
    });
  } catch (err) {
    console.error(
      "[clinical-invariant-audit] orphan-dispense-denied emission failed",
      err,
    );
  }
}

export interface EmitClinicalInvariantEmergencyBypassAuditInput {
  clinicId: string;
  /** The user who triggered the emergency dispense (for forensic trace). */
  userId: string;
  containerId: string;
  requestId: string;
  bypassReason: string;
}

/**
 * Phase 5 PR 5.7 — emergency-bypass audit.
 *
 * Emitted when the evaluator's emergency carve-out (CI-7) fires
 * (`isEmergency=true` + valid `bypassReason`) — the evaluator
 * returned `disposition: "EMERGENCY_BYPASS"` and the wiring layer
 * captures this for post-commit emission.
 *
 * Fire-and-forget post-commit. Gated by `AUTHORITY_OBS_V1`.
 * Rate-limited per `(clinicId, userId, containerId)` per 60s.
 */
export function emitClinicalInvariantEmergencyBypassAudit(
  args: EmitClinicalInvariantEmergencyBypassAuditInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId) return;

  const key = `clinical_invariant_emergency_bypass:${args.clinicId}:${args.userId}:${args.containerId}`;
  if (!emergencyBypassLimiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId: args.clinicId,
      actionType: "clinical_invariant_emergency_bypass",
      performedBy: args.userId || "system:clinical_invariant_evaluator",
      performedByEmail: "",
      targetId: args.containerId,
      targetType: "container",
      metadata: {
        kind: "clinical_invariant_emergency_bypass",
        userId: args.userId,
        containerId: args.containerId,
        requestId: args.requestId,
        bypassReason: args.bypassReason,
      },
      actorRole: null,
    });
  } catch (err) {
    console.error(
      "[clinical-invariant-audit] emergency-bypass emission failed",
      err,
    );
  }
}

export interface EmitClinicalInvariantFailOpenAuditInput {
  clinicId: string;
  /** Logical route — `dispense.confirm` or `containers.dispense`. */
  route: string;
  requestId: string;
  /** Optional error class name for forensic trace (no stack/PII). */
  errorType?: string;
}

/**
 * Phase 5 PR 5.7 — fail-open audit.
 *
 * Emitted when `SMART_COP_VALIDATION_FAIL_OPEN=true` AND an evaluator
 * (or its DB reads) threw, and the wiring layer degraded to allow.
 *
 * Fire-and-forget post-commit. Gated by `AUTHORITY_OBS_V1`.
 * Rate-limited per `(clinicId, route)` per 60s.
 */
export function emitClinicalInvariantFailOpenAudit(
  args: EmitClinicalInvariantFailOpenAuditInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId) return;

  const key = `clinical_invariant_fail_open:${args.clinicId}:${args.route}`;
  if (!failOpenLimiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId: args.clinicId,
      actionType: "clinical_invariant_fail_open",
      performedBy: "system:clinical_invariant_evaluator",
      performedByEmail: "",
      targetId: null,
      targetType: null,
      metadata: {
        kind: "clinical_invariant_fail_open",
        route: args.route,
        requestId: args.requestId,
        errorType: args.errorType ?? null,
      },
      actorRole: null,
    });
  } catch (err) {
    console.error(
      "[clinical-invariant-audit] fail-open emission failed",
      err,
    );
  }
}
