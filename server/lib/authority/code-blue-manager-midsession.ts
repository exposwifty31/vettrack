/**
 * Phase 4 PR 4.4a — Mid-session manager-downgrade shadow detection.
 *
 * Called from POST /api/code-blue/sessions/:id/logs to detect drift of the
 * PERSISTED manager's Code-Blue eligibility during the active session.
 * Shadow-only: emits audit/metric, never blocks the log write.
 *
 * This is structurally similar to the PR 4.3 end-time drift detection but
 * emits a DISTINCT audit kind (`code_blue_manager_midsession_authority_shadow_denied`)
 * and DISTINCT flat counters (`code_blue_manager_midsession_shadow_denied_*`)
 * so operators can separate the mid-session log-write signal from the
 * init/end signals.
 *
 * The helper reuses the FROZEN PR 4.2 wiring helper (`loadCodeBlueManagerLookup`)
 * and the FROZEN PR 4.1 pure predicate (`computeCodeBlueManagerSnapshotDeny`).
 * It does NOT invoke `evaluateCodeBlueManagerAuthority` because that emits
 * the `code_blue_manager_authority_shadow_denied` kind — wrong family.
 *
 * Defensive contract (master plan §9 + PR 4.3 lessons): the helper internally
 * catches all errors and never throws. Callers can `await` without their own
 * try/catch — but route handlers MAY also defensively try/catch as belt-and-
 * suspenders given the never-block contract is load-bearing.
 */

import { logAudit, type AuditActionType } from "../audit.js";
import { createLogLimiter } from "../log-safety.js";
import { incrementMetric } from "../metrics.js";
import { loadCodeBlueManagerLookup } from "./code-blue-manager.wiring.js";
import { computeCodeBlueManagerSnapshotDeny } from "./enforcement/code-blue-manager.evaluator.js";
import type { CodeBlueManagerDenyReason } from "./enforcement/code-blue-manager.types.js";

const MIDSESSION_AUDIT_KIND: AuditActionType =
  "code_blue_manager_midsession_authority_shadow_denied";

// Independent rate-limiter bucket (60s dedupe window) — mirrors the PR 4.1
// emitter pattern in code-blue-manager.audit.ts. In a real Code Blue, log
// writes are frequent (drug/shock/cpr/note/equipment entries every few
// seconds); without this limiter, every log write past the moment of drift
// would enqueue a full audit + outbox row for the same condition. The
// counter increment is NOT rate-limited (counter volume IS the signal —
// counter cardinality is bounded to a single flat integer per reason);
// only the durable audit row is throttled.
const midsessionAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

function isAuthorityObsV1Enabled(): boolean {
  return process.env.AUTHORITY_OBS_V1 === "true";
}

function midsessionCounterForReason(
  reason: CodeBlueManagerDenyReason,
): string | null {
  switch (reason) {
    case "OPROLE_NOT_IN_CB_ALLOWLIST":
      return "code_blue_manager_midsession_shadow_denied_oprole_not_in_allowlist";
    case "NO_OPEN_CHECK_IN":
      return "code_blue_manager_midsession_shadow_denied_no_open_check_in";
    // Mid-session detection only inspects the snapshot branch. Cross-clinic
    // and user-missing cases would indicate data corruption rather than a
    // mid-session drift signal — they are silently ignored here (the init
    // and end paths already capture them via their own dedicated counters).
    case "MANAGER_CROSS_CLINIC":
    case "USER_MISSING":
      return null;
  }
}

export interface DetectMidsessionManagerDriftInput {
  clinicId: string;
  sessionId: string;
  /**
   * The persisted manager from the loaded session row. May be null/undefined
   * if the schema ever permits a manager-less session; the helper no-ops
   * safely in that case.
   */
  managerUserId: string | null | undefined;
  now?: Date;
}

/**
 * Inspect the persisted manager's authority against the Code-Blue allowlist
 * at log-write time. On crossover (OPROLE_NOT_IN_CB_ALLOWLIST or
 * NO_OPEN_CHECK_IN), increment the dedicated mid-session counter and emit
 * the dedicated mid-session audit kind. Never throws; never blocks.
 *
 * The caller's request semantics are unchanged regardless of the outcome.
 */
export async function detectMidsessionManagerDrift(
  input: DetectMidsessionManagerDriftInput,
): Promise<void> {
  try {
    if (!input.managerUserId) return;
    const now = input.now ?? new Date();
    const lookup = await loadCodeBlueManagerLookup({
      clinicId: input.clinicId,
      managerUserId: input.managerUserId,
      now,
    });

    // Only the snapshot branch produces a meaningful mid-session signal.
    // resolver_fault, cross_clinic, and user_missing are not interpreted
    // as drift in this code path.
    if (lookup.kind !== "snapshot") return;

    const result = computeCodeBlueManagerSnapshotDeny(lookup.snapshot);
    if (result.kind !== "deny") return; // allow or mode_inactive → no signal

    const counterName = midsessionCounterForReason(result.reason);
    if (counterName === null) return;

    incrementMetric(counterName);

    if (!isAuthorityObsV1Enabled()) return;
    if (!input.clinicId || !input.managerUserId) return;

    // Rate-limit the audit emission per (clinicId, sessionId, managerUserId,
    // reason) tuple. In a sustained drift condition, at most one audit row
    // per 60s — mirrors the PR 4.1 emitter discipline.
    const limiterKey = `midsession:${input.clinicId}:${input.sessionId}:${input.managerUserId}:${result.reason}`;
    if (!midsessionAuditLimiter.shouldLog(limiterKey)) return;

    logAudit({
      clinicId: input.clinicId,
      actionType: MIDSESSION_AUDIT_KIND,
      performedBy: input.managerUserId,
      // logAudit signature requires a string; the actor email is not
      // available in this helper (the actor is the log-writer, not the
      // manager). Empty-string matches the "unknown" sentinel used by
      // the existing enforcement audit emitters.
      performedByEmail: "",
      targetId: input.managerUserId,
      targetType: "code_blue_manager_midsession_authority_decision",
      metadata: {
        kind: "midsession_shadow_denied",
        reason: result.reason,
        sessionId: input.sessionId,
        managerUserId: input.managerUserId,
        resolvedAt: now.toISOString(),
        severity: "info",
      },
      actorRole: null,
    });
  } catch (err) {
    // Belt-and-suspenders: NEVER let mid-session detection block a log
    // write. The shadow signal is best-effort observability; if any
    // dependency throws (DB, resolver, audit emit, metric increment),
    // the log write must still succeed.
    console.error(
      "[code-blue] midsession manager-drift detection failed (shadow); log write continues",
      err,
    );
  }
}
