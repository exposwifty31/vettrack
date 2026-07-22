/**
 * VetTrack 2.0, Task 1.1 §1.3 — `action_proposal` service. Kind-agnostic:
 * `stageProposal` / `approveProposal` / `editProposal` / `rejectProposal` are
 * shared across all 4 proposal kinds (§2–§5) via the shared `ActionProposalWriter`
 * port. `approveProposal` is a generic status flip here — a kind-specific side
 * effect (e.g. `restock_po_on_burn` inserting real PO rows on approve) is a
 * later slice's responsibility, dispatched by kind, not built in §1.
 */
import { logAudit } from "../audit.js";
import { incrementMetric } from "../metrics.js";
import { validateActionProposalCitations } from "./action-proposal-citation-validator.js";
import {
  ActionProposalAlreadyDecidedError,
  type ActionProposalTransactionExecutor,
  type ActionProposalWriter,
  type StageOutcome,
} from "./action-proposal-writer.port.js";
import { buildRestockPoApproveSideEffect } from "./restock-po-approve-side-effect.js";
import { validateEditedContentForKind } from "./action-proposal-types.js";
import type { ActionProposalCitedFact, NewActionProposalInput } from "./action-proposal-types.js";
import type { ActionProposalRow } from "../../schema/ops.js";

export { ActionProposalAlreadyDecidedError };

export class ActionProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`Action proposal ${proposalId} not found`);
    this.name = "ActionProposalNotFoundError";
  }
}

/**
 * Task 1.1 §4 (deliverable E) — a proposal's edit body failed its kind's
 * per-kind Zod schema (`validateEditedContentForKind`,
 * `action-proposal-types.ts`). Named `.name` (not `instanceof`) is what
 * `server/routes/action-proposals.ts`'s `mapError` checks — deliberately,
 * since that route's unit test mocks this whole module and an `instanceof`
 * check against a possibly-`undefined` mocked export throws instead of
 * falling through.
 */
export class ActionProposalEditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionProposalEditValidationError";
  }
}

export interface ActionProposalServiceDeps {
  writer: ActionProposalWriter;
}

export interface StagedByActor {
  performedBy: string;
  performedByEmail: string;
}

export interface StageProposalParams {
  input: NewActionProposalInput;
  groundTruthFacts: readonly ActionProposalCitedFact[];
  stagedBy: StagedByActor;
}

export async function stageProposal(
  deps: ActionProposalServiceDeps,
  params: StageProposalParams,
): Promise<StageOutcome> {
  const citationValidation = validateActionProposalCitations(params.input.citedFacts, params.groundTruthFacts);
  const outcome = await deps.writer.stage({ ...params.input, citationValidation });

  if (outcome.created) {
    incrementMetric("autopilot_proposal_staged_total");
    logAudit({
      clinicId: params.input.clinicId,
      actionType: "action_proposal_staged",
      performedBy: params.stagedBy.performedBy,
      performedByEmail: params.stagedBy.performedByEmail,
      targetId: outcome.proposal.id,
      targetType: "action_proposal",
      metadata: { kind: params.input.kind, sourceSessionId: params.input.sourceSessionId },
    });
  }

  return outcome;
}

interface DecideProposalParams {
  clinicId: string;
  proposalId: string;
  actorUserId: string;
  actorEmail: string;
  actorRole?: string | null;
}

async function decide(
  deps: ActionProposalServiceDeps,
  params: DecideProposalParams,
  decision: Exclude<ActionProposalRow["status"], "staged">,
  content: { editedContent?: unknown; rejectionReason?: string },
  buildSideEffect?: (
    staged: ActionProposalRow,
  ) => ((tx: ActionProposalTransactionExecutor) => Promise<void>) | undefined,
): Promise<ActionProposalRow> {
  const staged = await deps.writer.get(params.clinicId, params.proposalId);
  if (!staged) throw new ActionProposalNotFoundError(params.proposalId);

  if (decision === "edited") {
    const check = validateEditedContentForKind(staged.kind, content.editedContent);
    if (!check.valid) {
      throw new ActionProposalEditValidationError(
        check.message ?? `editedContent does not match the ${staged.kind} schema`,
      );
    }
  }

  const decidedAt = new Date();
  // Task 1.1 §3.A: the transition + decision-log append are ONE atomic
  // writer call (db.transaction in the Drizzle impl) — a decision-log row
  // exists iff the transition succeeded. Task 1.1 §4 extends this with an
  // optional kind-dispatched `sideEffect` (e.g. `restock_po_on_burn`
  // inserting real PO rows) participating in the SAME atomic unit — see
  // `ActionProposalWriter.transitionAndRecord`'s docstring.
  const { proposal: updated } = await deps.writer.transitionAndRecord({
    clinicId: params.clinicId,
    proposalId: params.proposalId,
    patch: {
      status: decision,
      decidedByUserId: params.actorUserId,
      decidedAt,
      editedContent: content.editedContent,
      rejectionReason: content.rejectionReason,
    },
    decisionMeta: {
      stagedSummary: staged.summary,
      stagedCitedFacts: staged.citedFacts,
      stagedDraftContent: staged.draftContent,
    },
    sideEffect: buildSideEffect?.(staged),
  });

  const auditActionType =
    decision === "approved"
      ? "action_proposal_approved"
      : decision === "edited"
        ? "action_proposal_edited"
        : "action_proposal_rejected";
  const metricName =
    decision === "approved"
      ? "autopilot_proposal_approved_total"
      : decision === "edited"
        ? "autopilot_proposal_edited_total"
        : "autopilot_proposal_rejected_total";

  incrementMetric(metricName);
  logAudit({
    clinicId: params.clinicId,
    actionType: auditActionType,
    performedBy: params.actorUserId,
    performedByEmail: params.actorEmail,
    targetId: updated.id,
    targetType: "action_proposal",
    actorRole: params.actorRole,
    metadata: { kind: updated.kind },
  });

  return updated;
}

/**
 * Task 1.1 §4 — `approveProposal` is a generic status flip for 3 of the 4
 * kinds. For `restock_po_on_burn` specifically, approve ALSO inserts real
 * `vt_purchase_orders`/`vt_po_lines` rows — a kind-dispatched side effect
 * (`buildRestockPoApproveSideEffect`) executed atomically with the
 * transition (same `db.transaction`, see `ActionProposalWriter.
 * transitionAndRecord`). `buildRestockPoApproveSideEffect` itself returns
 * `undefined` for every other kind, so this stays a no-op for them.
 */
export async function approveProposal(
  deps: ActionProposalServiceDeps,
  params: DecideProposalParams,
): Promise<ActionProposalRow> {
  return decide(deps, params, "approved", {}, (staged) =>
    buildRestockPoApproveSideEffect(staged, params.actorUserId),
  );
}

export async function editProposal(
  deps: ActionProposalServiceDeps,
  params: DecideProposalParams & { editedContent: Record<string, unknown> },
): Promise<ActionProposalRow> {
  return decide(deps, params, "edited", { editedContent: params.editedContent });
}

export async function rejectProposal(
  deps: ActionProposalServiceDeps,
  params: DecideProposalParams & { rejectionReason: string },
): Promise<ActionProposalRow> {
  if (!params.rejectionReason || params.rejectionReason.trim().length === 0) {
    throw new Error("rejectionReason is required");
  }
  return decide(deps, params, "rejected", { rejectionReason: params.rejectionReason });
}
