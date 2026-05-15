/**
 * Phase 3 PR 3.6 — Stale-task-ownership audit emitters.
 *
 * Two emitter shapes:
 *   - `emitStaleTaskOwnershipWouldHaveRevokedAudit` — shadow-mode
 *     observation that a task WOULD HAVE been revoked. Gated by
 *     `AUTHORITY_OBS_V1`, rate-limited per (clinicId, taskId) per 60s.
 *   - `emitStaleTaskOwnershipSweeperLifecycle` — worker lifecycle event
 *     (started / completed). Gated by `AUTHORITY_OBS_V1`, rate-limited
 *     per clinic per 5 minutes so heartbeats don't flood the audit log.
 *
 * Per §11.8 of the master plan, PR 3.6 MUST NOT emit live revocation
 * audit rows. No such emitter is defined here; live revocation is the
 * scope of PR 3.8.
 */

import { logAudit, type AuditDbExecutor } from "../../audit.js";
import { createLogLimiter } from "../../log-safety.js";

function isAuthorityObsV1Enabled(): boolean {
  return process.env.AUTHORITY_OBS_V1 === "true";
}

// Independent rate-limiter buckets so this family cannot starve other
// authority-audit families. 60s dedupe window matches the PR 3.3 emitter.
const wouldHaveRevokedLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

const sweeperLifecycleLimiter = createLogLimiter({
  dedupeWindowMs: 5 * 60_000,
  sampleRate: 1,
  maxEntries: 200,
});

export interface EmitStaleTaskOwnershipWouldHaveRevokedAuditInput {
  clinicId: string;
  taskId: string;
  ownerUserId: string;
  ownerCheckInEndedAt: Date | null;
  taskUpdatedAt: Date;
  graceWindowMs: number;
  activityWindowMs: number;
}

export function emitStaleTaskOwnershipWouldHaveRevokedAudit(
  args: EmitStaleTaskOwnershipWouldHaveRevokedAuditInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId || !args.taskId) return;

  const key = `stale_task_ownership_would_revoke:${args.clinicId}:${args.taskId}`;
  if (!wouldHaveRevokedLimiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId: args.clinicId,
      actionType: "stale_task_ownership_would_have_revoked",
      performedBy: "system:stale_task_ownership_sweeper",
      performedByEmail: "",
      targetId: args.taskId,
      targetType: "appointment",
      metadata: {
        kind: "stale_task_ownership",
        ownerUserId: args.ownerUserId,
        ownerCheckInEndedAt: args.ownerCheckInEndedAt?.toISOString() ?? null,
        taskUpdatedAt: args.taskUpdatedAt.toISOString(),
        graceWindowMs: args.graceWindowMs,
        activityWindowMs: args.activityWindowMs,
      },
      actorRole: null,
    });
  } catch (err) {
    console.error("[stale-task-ownership-audit] would-have-revoked emission failed", err);
  }
}

/**
 * Phase 3 PR 3.8 — Live revocation audit emitter.
 *
 * Emitted by the sweeper (and any future caller) when a stale ownership
 * row is actually revoked in enforce mode. The transactional-audit
 * invariant from §13.7: every live revocation must produce one audit
 * row in the same transaction as the UPDATE.
 *
 * This is the live counterpart to the PR 3.6 shadow-only
 * `emitStaleTaskOwnershipWouldHaveRevokedAudit`. Both emitters coexist
 * because shadow and live observations have different operational
 * meanings — shadow logs "would have happened"; revoked logs "did
 * happen."
 */
const revokedLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

export interface EmitStaleTaskOwnershipRevokedAuditInput {
  clinicId: string;
  taskId: string;
  /** The owner whose ownership was revoked. */
  ownerUserId: string;
  /** Their check-in's checkedOutAt that triggered the staleness verdict. */
  ownerCheckInEndedAt: Date | null;
  /** The task's updatedAt at revocation time (for activity-window forensics). */
  taskUpdatedAt: Date;
  graceWindowMs: number;
  activityWindowMs: number;
  /** Status prior to revocation (so audit captures the lifecycle context). */
  previousStatus: string;
  /** Status after revocation (`assigned` when reset from `in_progress`). */
  newStatus: string;
  /**
   * Required for §13.7 transactional-audit invariant. When supplied, the
   * audit row is written inside the same transaction as the ownership
   * UPDATE. The caller (sweeper enforce path) MUST pass this in PR 3.8
   * to guarantee atomicity. Existing PR 3.6 shadow-emitter call sites
   * don't supply tx because they don't mutate any DB state.
   */
  tx?: AuditDbExecutor;
  /**
   * PR 3.8.1 — bypass the `AUTHORITY_OBS_V1` flag AND the rate-limiter.
   * Live revocations are NOT observability events — they are the audit
   * trail for an authoritative DB mutation, and §13.7 requires them to
   * be written transactionally with the UPDATE. Without `force`, both
   * gates can independently silently drop the audit row, leaving an
   * ownership revocation with no corresponding audit history.
   *
   * Caller contract: pass `force: true` for live-revocation audit
   * emissions. Shadow-mode observations omit `force` to preserve the
   * existing observability-gate semantics.
   */
  force?: boolean;
}

export function emitStaleTaskOwnershipRevokedAudit(
  args: EmitStaleTaskOwnershipRevokedAuditInput,
): void | Promise<void> {
  // Required-field check FIRST. For `force` callers, a missing
  // clinicId or taskId is a programming error that must NOT silently
  // skip — otherwise the caller's db.transaction would commit the
  // ownership UPDATE without an audit row, violating §13.7. Throwing
  // surfaces the misuse and rolls back the transaction.
  if (!args.clinicId || !args.taskId) {
    if (args.force) {
      throw new Error(
        "emitStaleTaskOwnershipRevokedAudit: clinicId and taskId are required when force=true",
      );
    }
    return;
  }
  // The two observability gates are bypassed when `force: true` so the
  // §13.7 transactional-audit invariant is unconditional for live
  // revocations regardless of `AUTHORITY_OBS_V1` configuration.
  if (!args.force) {
    if (!isAuthorityObsV1Enabled()) return;
    const key = `stale_task_ownership_revoked:${args.clinicId}:${args.taskId}`;
    if (!revokedLimiter.shouldLog(key)) return;
  }

  const params = {
    clinicId: args.clinicId,
    actionType: "stale_task_ownership_revoked" as const,
    performedBy: "system:stale_task_ownership_sweeper",
    performedByEmail: "",
    targetId: args.taskId,
    targetType: "appointment",
    metadata: {
      kind: "stale_task_ownership_revocation",
      ownerUserId: args.ownerUserId,
      ownerCheckInEndedAt: args.ownerCheckInEndedAt?.toISOString() ?? null,
      taskUpdatedAt: args.taskUpdatedAt.toISOString(),
      graceWindowMs: args.graceWindowMs,
      activityWindowMs: args.activityWindowMs,
      previousStatus: args.previousStatus,
      newStatus: args.newStatus,
    },
    actorRole: null,
  };

  if (args.tx) {
    // Transactional variant — audit row is inserted in the same
    // transaction as the caller's UPDATE. Returns a Promise the
    // caller awaits to keep the transaction open until the audit
    // INSERT completes. §13.7 atomic-audit invariant.
    //
    // No try/catch here. If logAudit rejects (either synchronously by
    // throwing, or asynchronously via the returned Promise), the
    // rejection MUST propagate so the caller's db.transaction rolls
    // back — leaving the ownership UPDATE unwritten rather than
    // committing it without the audit row.
    return logAudit({ ...params, tx: args.tx });
  }

  // Non-transactional fire-and-forget (shadow / observation path). The
  // try/catch is appropriate here because there's no transaction to
  // protect; the audit row is best-effort observability.
  try {
    logAudit(params);
  } catch (err) {
    console.error("[stale-task-ownership-audit] revoked emission failed", err);
  }
}

export type SweeperLifecycleEvent = "started" | "completed";

export interface EmitStaleTaskOwnershipSweeperLifecycleInput {
  clinicId: string;
  event: SweeperLifecycleEvent;
  jobId: string;
  metadata?: Record<string, unknown>;
}

export function emitStaleTaskOwnershipSweeperLifecycle(
  args: EmitStaleTaskOwnershipSweeperLifecycleInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!args.clinicId) return;

  const key = `stale_task_ownership_sweeper:${args.clinicId}:${args.event}`;
  if (!sweeperLifecycleLimiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId: args.clinicId,
      actionType:
        args.event === "started"
          ? "stale_task_ownership_sweeper_started"
          : "stale_task_ownership_sweeper_completed",
      performedBy: "system:stale_task_ownership_sweeper",
      performedByEmail: "",
      targetId: args.jobId,
      targetType: "sweeper_job",
      metadata: { event: args.event, ...(args.metadata ?? {}) },
      actorRole: null,
    });
  } catch (err) {
    console.error("[stale-task-ownership-audit] sweeper lifecycle emission failed", err);
  }
}
