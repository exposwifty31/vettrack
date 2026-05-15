/**
 * Phase 3 PR 3.3 — Task-assignment evaluator durable audit emission.
 *
 * Mirrors the PR 7 pattern in `enforcement/audit.ts`:
 *  - gated by `AUTHORITY_OBS_V1` (same flag as the existing stale/oprole audit)
 *  - fire-and-forget via `logAudit`
 *  - rate-limited per (clinicId, actorUserId, transition) — 60s dedupe window
 *  - independent limiter bucket so this audit cannot starve stale/oprole
 *
 * Shadow mode never writes a row. Only enforce-mode denials call this emitter
 * (the evaluator enforces this — shadow returns `allow` and never reaches the
 * audit path).
 */

import { logAudit } from "../../audit.js";
import { createLogLimiter } from "../../log-safety.js";
import type {
  TaskAssignmentContext,
  TaskAssignmentDenyReason,
} from "./result.js";

function isAuthorityObsV1Enabled(): boolean {
  return process.env.AUTHORITY_OBS_V1 === "true";
}

// Independent rate-limiter bucket so task-assignment denials cannot starve
// stale/oprole denials and vice versa. 60s dedupe window matches the
// existing emitter in enforcement/audit.ts.
const taskAssignmentAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

export interface EmitTaskAssignmentDenialAuditInput {
  ctx: TaskAssignmentContext;
  reason: TaskAssignmentDenyReason;
}

export function emitTaskAssignmentDenialAudit(
  args: EmitTaskAssignmentDenialAuditInput,
): void {
  if (!isAuthorityObsV1Enabled()) return;
  const { ctx, reason } = args;
  if (!ctx.clinicId || !ctx.actor.userId) return;

  const key = `task_assignment:${ctx.clinicId}:${ctx.actor.userId}:${ctx.transition}`;
  if (!taskAssignmentAuditLimiter.shouldLog(key)) return;

  try {
    logAudit({
      clinicId: ctx.clinicId,
      actionType: "task_assignment_enforcement_denied",
      performedBy: ctx.actor.userId,
      // logAudit signature requires string; email is not available inside the
      // evaluator (no req). Empty-string matches the "unknown" sentinel used
      // by enforcement/audit.ts.
      performedByEmail: "",
      targetId: ctx.target.userId,
      targetType: "task_assignment_decision",
      metadata: {
        kind: "task_assignment",
        reason,
        transition: ctx.transition,
        taskType: ctx.taskType,
        actorRole: ctx.actor.role,
        targetRole: ctx.target.role,
        targetStatus: ctx.target.status,
        targetClinicId: ctx.target.clinicId,
        currentAcknowledgedUserId: ctx.currentOwnership.acknowledgedUserId,
        currentStatus: ctx.currentOwnership.status,
        resolvedAt: ctx.now.toISOString(),
      },
      actorRole: ctx.actor.role,
    });
  } catch (err) {
    // logAudit is already fire-and-forget; this catch is defense-in-depth.
    console.error("[task-assignment-audit] emission failed", err);
  }
}
