/**
 * VetTrack 2.0, Task 1.1 §1.4 — standalone citation-grounding validator for
 * `action_proposal` rows, shared across all 4 proposal kinds.
 *
 * Deliberately NOT routed through `server/domain/equipment/copilot/
 * citation-validator.ts`: that validator's `EvidenceGraph`/`CitationType`
 * shape is structurally scoped to one equipment's evidence (rfid reads,
 * scans, transfers, rooms, staging keyed to a single `equipmentId`) — it has
 * no field that can hold outbox/audit facts spanning many entities across a
 * shift window or other kind-specific content source. This is a disclosed,
 * intentional parallel validator (see docs/plans/2.0/autopilot-spike-findings.md
 * §5), not a hidden shortcut.
 *
 * Pure function, no I/O: given a proposal's cited facts and the kind-specific
 * reader's ground-truth fact set, returns which citations are grounded.
 *
 * Self-consistency caveat (carried forward from the spike): checking a
 * proposal's citations against the same source data that produced them
 * proves "did we cite what we used", not "is the underlying reasoning
 * correct" — a real anti-hallucination gate needs an independently-derived
 * draft checked against DB ground truth, which is out of scope here.
 */
import type { ActionProposalCitedFact } from "./action-proposal-types.js";

export interface ActionProposalCitationCheck {
  sourceId: string;
  valid: boolean;
  flag?: string;
}

export interface ActionProposalCitationValidation {
  valid: boolean;
  checks: ActionProposalCitationCheck[];
}

export function validateActionProposalCitations(
  citedFacts: readonly ActionProposalCitedFact[],
  groundTruthFacts: readonly ActionProposalCitedFact[],
): ActionProposalCitationValidation {
  const groundTruthIds = new Set(groundTruthFacts.map((fact) => fact.sourceId));

  const checks: ActionProposalCitationCheck[] = citedFacts.map((fact) => {
    if (groundTruthIds.has(fact.sourceId)) {
      return { sourceId: fact.sourceId, valid: true };
    }
    return {
      sourceId: fact.sourceId,
      valid: false,
      flag: `citation_not_grounded:${fact.sourceId}`,
    };
  });

  return {
    valid: checks.every((check) => check.valid),
    checks,
  };
}
