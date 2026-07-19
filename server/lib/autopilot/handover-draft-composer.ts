/**
 * Task 0.3 spike — pure composer: `ShiftHandoverDeltas` -> a
 * `shift_handover_draft` action-proposal shape.
 *
 * No DB, no side effects. Callers supply `deltas` however they obtained them
 * (the fake reader path in tests, or the real `resolveShiftWindow` +
 * `aggregateDeltas` path in production — see
 * server/workers/autopilotHandoverDraftWorker.ts). This keeps the "turn facts
 * into a proposal" logic testable independent of I/O.
 */
import type { ShiftHandoverDeltas } from "../shift-handover.js";
import type { ShiftWindow } from "../shift-handover-generator.js";
import {
  ACTION_PROPOSAL_CITATION_CATEGORIES,
  type ActionProposalCitedFact,
  type ActionProposalCitationCategory,
  type ActionProposalCitationValidation,
  type ActionProposalDraftContent,
  type ActionProposalSourceRef,
  type NewActionProposalInput,
} from "./action-proposal-types.js";
import { validateProposalCitations } from "./action-proposal-citation-validator.js";

const CATEGORY_LABEL: Record<ActionProposalCitationCategory, string> = {
  custody: "custody",
  taskState: "task",
  alerts: "alert",
  dispenses: "dispense",
};

/** Deterministic, locale-neutral one-line summary — a real i18n pass belongs to Task 1.1. */
export function summarizeDeltas(deltas: ShiftHandoverDeltas): string {
  const parts: string[] = [];
  for (const category of ACTION_PROPOSAL_CITATION_CATEGORIES) {
    const count = deltas[category].length;
    if (count > 0) parts.push(`${count} ${CATEGORY_LABEL[category]} event${count === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return "No activity recorded during this shift window.";
  return `Shift handover draft: ${parts.join(", ")} during the shift window.`;
}

/** Flatten `ShiftHandoverDeltas` into the cited-facts shape (mirrors `aggregateDeltasViaReader`'s output). */
export function deltasToCitedFacts(deltas: ShiftHandoverDeltas): ActionProposalCitedFact[] {
  const facts: ActionProposalCitedFact[] = [];
  for (const category of ACTION_PROPOSAL_CITATION_CATEGORIES) {
    for (const entry of deltas[category]) {
      facts.push({
        // Outbox ids are bigserial (all-digit); audit ids are UUIDs (always
        // contain a dash) — a purely numeric sourceId can only be an outbox row.
        sourceTable: /^\d+$/.test(entry.sourceId) ? "vt_event_outbox" : "vt_audit_logs",
        sourceId: entry.sourceId,
        kind: entry.kind,
        category,
        at: entry.at,
      });
    }
  }
  facts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return facts;
}

export interface ComposeHandoverDraftParams {
  clinicId: string;
  proposalId: string;
  shiftSessionId: string;
  window: ShiftWindow;
  deltas: ShiftHandoverDeltas;
  /**
   * Ground-truth cited facts to validate against, independent of the ones
   * this composer emits (e.g. the reader's own flattened output). Defaults
   * to `deltasToCitedFacts(deltas)` when omitted — the production path
   * (real `aggregateDeltas`) has no separate ground-truth source, so the
   * proposal's own citations ARE the ground truth (self-consistent by
   * construction). Tests that want to prove the negative path pass a
   * deliberately tampered ground-truth list, or validate a tampered
   * citedFacts array directly against `action-proposal-citation-validator.ts`.
   */
  groundTruthFacts?: ActionProposalCitedFact[];
}

/** Pure: `ShiftHandoverDeltas` + window -> a `NewActionProposalInput` ready to stage. */
export function composeHandoverDraftProposal(params: ComposeHandoverDraftParams): NewActionProposalInput {
  const { clinicId, proposalId, shiftSessionId, window, deltas } = params;
  const citedFacts = deltasToCitedFacts(deltas);
  const groundTruth = params.groundTruthFacts ?? citedFacts;
  const validationResult = validateProposalCitations(citedFacts, groundTruth);
  const citationValidation: ActionProposalCitationValidation = validationResult.valid
    ? { valid: true, errors: [] }
    : { valid: false, errors: validationResult.errors };

  const sourceRef: ActionProposalSourceRef = {
    shiftSessionId,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
  };

  const draftContent: ActionProposalDraftContent = { deltas };

  return {
    id: proposalId,
    clinicId,
    kind: "shift_handover_draft",
    sourceSessionId: shiftSessionId,
    summary: summarizeDeltas(deltas),
    citedFacts,
    draftContent,
    sourceRef,
    citationValidation,
  };
}
