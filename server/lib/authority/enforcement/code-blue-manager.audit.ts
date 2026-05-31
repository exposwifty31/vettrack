/**
 * Phase 4 PR 4.1 — Code Blue manager evaluator audit emitter.
 *
 * Mirrors the PR 7 / PR 3.3 / PR 3.6 pattern:
 *   - gated by `AUTHORITY_OBS_V1` (same env flag as the existing enforcement
 *     audit emitters)
 *   - fire-and-forget via `logAudit`
 *   - rate-limited per (kind, clinicId, managerUserId, endpoint) — 60s dedupe
 *   - independent limiter buckets so this family cannot starve stale / oprole
 *     / task-assignment / stale-task-ownership audits and vice versa
 *
 * Foundation-only contract (§15 PR 4.1): not invoked by any route in this PR.
 * The emitter is exercised only by tests until PR 4.2 / 4.3 wire it.
 *
 * Audit-kind ownership:
 *   - `code_blue_initiator_authority_denied` — PR 4.2 (initiator clinical-gate
 *     denial, hard 403; emitted there, not by this evaluator).
 *   - `code_blue_manager_authority_shadow_denied` — emitted here in shadow
 *     mode on any deny reason.
 *   - `code_blue_manager_authority_denied` — emitted here in enforce mode.
 *   - `code_blue_manager_authority_fault_open` — emitted here in both shadow
 *     and enforce when the caller's lookup is `resolver_fault` (severity=high).
 */

import { isAuthorityObsV1Enabled } from "../../authority-audit.js";
import { logAudit, type AuditActionType } from "../../audit.js";
import { createLogLimiter } from "../../log-safety.js";
import type {
  CodeBlueManagerContext,
  CodeBlueManagerDenyReason,
} from "./code-blue-manager.types.js";

// Independent rate-limiter buckets so each audit kind has its own 60s dedupe
// window and one family can't starve the others. Bucket key includes the
// endpoint so initiation and end signals stay separately observable.
const shadowAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

const denyAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

const faultOpenAuditLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 500,
});

type ShadowDeniedKind = "shadow_denied";
type DeniedKind = "denied";
type FaultOpenKind = "fault_open";

export interface CodeBlueManagerAuditInput {
  ctx: CodeBlueManagerContext;
  reason: CodeBlueManagerDenyReason;
}

function emit(
  kind: ShadowDeniedKind | DeniedKind | FaultOpenKind,
  ctx: CodeBlueManagerContext,
  reason: CodeBlueManagerDenyReason | null,
  severity: "info" | "high",
): void {
  if (!isAuthorityObsV1Enabled()) return;
  if (!ctx.clinicId || !ctx.managerUserId) return;

  const limiter =
    kind === "shadow_denied"
      ? shadowAuditLimiter
      : kind === "denied"
        ? denyAuditLimiter
        : faultOpenAuditLimiter;

  const key = `${kind}:${ctx.clinicId}:${ctx.managerUserId}:${ctx.endpoint}`;
  if (!limiter.shouldLog(key)) return;

  const actionType: AuditActionType =
    kind === "shadow_denied"
      ? "code_blue_manager_authority_shadow_denied"
      : kind === "denied"
        ? "code_blue_manager_authority_denied"
        : "code_blue_manager_authority_fault_open";

  try {
    logAudit({
      clinicId: ctx.clinicId,
      actionType,
      performedBy: ctx.managerUserId,
      // logAudit signature requires string; email is not available inside the
      // evaluator (no req). Empty-string matches the "unknown" sentinel used
      // by enforcement/audit.ts.
      performedByEmail: "",
      targetId: ctx.managerUserId,
      targetType: "code_blue_manager_authority_decision",
      metadata: {
        kind,
        reason,
        endpoint: ctx.endpoint,
        managerUserId: ctx.managerUserId,
        resolvedAt: ctx.now.toISOString(),
        severity,
      },
      actorRole: null,
    });
  } catch (err) {
    // logAudit is already fire-and-forget; defense-in-depth.
    console.error("[code-blue-manager-audit] emission failed", err);
  }
}

export function emitCodeBlueManagerShadowDenied(
  args: CodeBlueManagerAuditInput,
): void {
  emit("shadow_denied", args.ctx, args.reason, "info");
}

export function emitCodeBlueManagerDenied(
  args: CodeBlueManagerAuditInput,
): void {
  emit("denied", args.ctx, args.reason, "info");
}

/**
 * Resolver-fault audit. Emitted in BOTH shadow and enforce when the caller's
 * lookup is `resolver_fault`. Severity=high so dashboards/alerting can
 * distinguish infra-driven fail-open from steady-state evaluator decisions.
 */
export function emitCodeBlueManagerFaultOpen(
  ctx: CodeBlueManagerContext,
): void {
  emit("fault_open", ctx, null, "high");
}
