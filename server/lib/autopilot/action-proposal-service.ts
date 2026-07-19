/**
 * Task 0.3 spike — the propose->approve loop's service layer.
 *
 * `composeAndStageHandoverDraft` is I/O-agnostic over how `deltas` were
 * obtained (fake reader in tests, real `aggregateDeltas` in production — see
 * server/workers/autopilotHandoverDraftWorker.ts) and idempotent per
 * `(clinicId, kind, sourceSessionId)` — a retried call returns the existing
 * staged row rather than double-staging.
 *
 * `approveProposal` / `editProposal` / `rejectProposal` each: (a) transition
 * the proposal's status exactly once (the writer's `transition` only matches
 * `status='staged'` rows, so a double-decision is a no-op error, never a
 * silent overwrite), (b) append the operations-memory decision row — the
 * labeled training data the roadmap's learning loop consumes, and (c) emit
 * the matching new `AuditActionType` member via `logAudit` (fire-and-forget,
 * repo convention — never awaited in a transaction path).
 */
import type { ShiftHandoverDeltas } from "../shift-handover.js";
import type { ShiftWindow } from "../shift-handover-generator.js";
import { logAudit } from "../audit.js";
import { composeHandoverDraftProposal } from "./handover-draft-composer.js";
import { newActionProposalId, type ActionProposalWriter } from "./action-proposal-writer.port.js";
import type {
  ActionProposalRecord,
  ActionProposalDecisionRecord,
  ActionProposalDraftContent,
} from "./action-proposal-types.js";

export interface ComposeAndStageHandoverDraftParams {
  clinicId: string;
  shiftSessionId: string;
  window: ShiftWindow;
  deltas: ShiftHandoverDeltas;
  writer: ActionProposalWriter;
}

export interface ComposeAndStageResult {
  proposal: ActionProposalRecord;
  /** True only when a NEW row was inserted this call — false on the idempotent retry path. */
  created: boolean;
}

export async function composeAndStageHandoverDraft(
  params: ComposeAndStageHandoverDraftParams,
): Promise<ComposeAndStageResult> {
  const { clinicId, shiftSessionId, window, deltas, writer } = params;

  const existing = await writer.findStaged(clinicId, "shift_handover_draft", shiftSessionId);
  if (existing) {
    return { proposal: existing, created: false };
  }

  const input = composeHandoverDraftProposal({
    clinicId,
    proposalId: newActionProposalId(),
    shiftSessionId,
    window,
    deltas,
  });

  const proposal = await writer.stage(input);

  logAudit({
    clinicId,
    actionType: "action_proposal_staged",
    performedBy: "system:shift_autopilot",
    performedByEmail: "shift-autopilot@vettrack.system",
    targetId: proposal.id,
    targetType: "action_proposal",
    metadata: { kind: proposal.kind, sourceSessionId: proposal.sourceSessionId },
  });

  return { proposal, created: true };
}

interface DecideParams {
  clinicId: string;
  proposalId: string;
  decidedByUserId: string;
  writer: ActionProposalWriter;
}

async function recordDecisionAndAudit(
  staged: ActionProposalRecord,
  decision: ActionProposalDecisionRecord["decision"],
  params: DecideParams,
  actionType: "action_proposal_approved" | "action_proposal_edited" | "action_proposal_rejected",
  editedContent: ActionProposalDraftContent | null,
  rejectionReason: string | null,
): Promise<void> {
  await params.writer.recordDecision({
    id: newActionProposalId(),
    clinicId: params.clinicId,
    proposalId: staged.id,
    kind: staged.kind,
    decision,
    decidedByUserId: params.decidedByUserId,
    decidedAt: new Date().toISOString(),
    stagedSummary: staged.summary,
    stagedCitedFacts: staged.citedFacts,
    stagedDraftContent: staged.draftContent,
    editedContent,
    rejectionReason,
  });

  logAudit({
    clinicId: params.clinicId,
    actionType,
    performedBy: params.decidedByUserId,
    performedByEmail: "",
    targetId: staged.id,
    targetType: "action_proposal",
    metadata: { kind: staged.kind, sourceSessionId: staged.sourceSessionId },
  });
}

/** Approve the proposal as-drafted, no changes. */
export async function approveProposal(params: DecideParams): Promise<ActionProposalRecord> {
  const staged = await params.writer.get(params.clinicId, params.proposalId);
  if (!staged || staged.status !== "staged") {
    throw new Error(`action-proposal: ${params.proposalId} is not staged`);
  }
  const updated = await params.writer.transition(params.clinicId, params.proposalId, {
    status: "approved",
    decidedByUserId: params.decidedByUserId,
  });
  await recordDecisionAndAudit(staged, "approved", params, "action_proposal_approved", null, null);
  return updated;
}

/** Approve with human-edited content — the edit itself is captured as labeled operations-memory. */
export async function editProposal(
  params: DecideParams & { editedContent: ActionProposalDraftContent },
): Promise<ActionProposalRecord> {
  const staged = await params.writer.get(params.clinicId, params.proposalId);
  if (!staged || staged.status !== "staged") {
    throw new Error(`action-proposal: ${params.proposalId} is not staged`);
  }
  const updated = await params.writer.transition(params.clinicId, params.proposalId, {
    status: "edited",
    decidedByUserId: params.decidedByUserId,
    editedContent: params.editedContent,
  });
  await recordDecisionAndAudit(staged, "edited", params, "action_proposal_edited", params.editedContent, null);
  return updated;
}

/** Reject with a required reason. */
export async function rejectProposal(
  params: DecideParams & { rejectionReason: string },
): Promise<ActionProposalRecord> {
  const staged = await params.writer.get(params.clinicId, params.proposalId);
  if (!staged || staged.status !== "staged") {
    throw new Error(`action-proposal: ${params.proposalId} is not staged`);
  }
  const updated = await params.writer.transition(params.clinicId, params.proposalId, {
    status: "rejected",
    decidedByUserId: params.decidedByUserId,
    rejectionReason: params.rejectionReason,
  });
  await recordDecisionAndAudit(staged, "rejected", params, "action_proposal_rejected", null, params.rejectionReason);
  return updated;
}
