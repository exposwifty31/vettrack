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

import { logAudit } from "../../audit.js";
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
