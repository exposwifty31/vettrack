/**
 * Task 0.3 spike — citation grounding for staged action-proposals.
 *
 * DESIGN NOTE (see spike findings §5 for the full writeup): this is a NEW,
 * analogous validator, not a literal reuse of
 * `server/domain/equipment/copilot/citation-validator.ts`. That validator's
 * `Citation`/`CopilotAnswer` types come from the FROZEN, closed
 * `shared/contracts/asset-copilot.v1.ts` contract — `CitationType` is a
 * closed union (`equipment | rfid | scan | transfer | sse | waitlist |
 * condition | room | dock | staging`) with no member for an outbox/audit-log
 * fact, and `citationExistsInGraph` checks membership against an
 * equipment-specific `EvidenceGraph` (rfid reads, scans, transfers, rooms,
 * staging — no outbox events at all). `ai-safety-validator.ts` hard-codes the
 * same closed allow-list. This spike's hard constraint is "additive only —
 * the only touch to existing shipped code is the one-keyword export"; adding
 * an `"outbox"` member to that frozen union (or constructing a fabricated
 * `EvidenceGraph` to smuggle outbox facts through it) would either violate
 * that constraint or misrepresent outbox facts as equipment-domain evidence.
 * So this file mirrors the EXACT SAME PATTERN — a `{valid: true} |
 * {valid: false, errors: string[]}` result, a per-citation existence check,
 * an allOf-citations wrapper — scoped to `ActionProposalCitedFact` /
 * ground-truth outbox+audit rows instead. Task 1.1 should decide whether to
 * widen the frozen `CitationType` union (an additive, non-breaking option
 * since it only ADDS a member) to unify the two validators, or keep them
 * separate because their domains (equipment state vs. operational
 * fact-stream) are genuinely different. See spike findings §8.
 */
import type { ActionProposalCitedFact } from "./action-proposal-types.js";

export type ProposalCitationValidityResult =
  | { valid: true }
  | { valid: false; errors: string[] };

function factKey(f: Pick<ActionProposalCitedFact, "sourceTable" | "sourceId">): string {
  return `${f.sourceTable}:${f.sourceId}`;
}

function citationExistsInGroundTruth(
  citation: ActionProposalCitedFact,
  groundTruth: ActionProposalCitedFact[],
): boolean {
  return groundTruth.some(
    (g) =>
      g.sourceTable === citation.sourceTable &&
      g.sourceId === citation.sourceId &&
      g.kind === citation.kind,
  );
}

/** Validity only — not semantic relevance (human review), mirrors `validateCitation`. */
export function validateProposalCitation(
  citation: ActionProposalCitedFact,
  groundTruth: ActionProposalCitedFact[],
): ProposalCitationValidityResult {
  const errors: string[] = [];
  if (!citation.sourceId?.trim()) errors.push("citation_missing_source_id");
  if (!citation.kind?.trim()) errors.push("citation_missing_kind");
  if (!citation.at) {
    errors.push("citation_missing_observed_at");
  } else if (Number.isNaN(new Date(citation.at).getTime())) {
    errors.push("citation_invalid_observed_at");
  }
  if (!citationExistsInGroundTruth(citation, groundTruth)) {
    errors.push(`citation_not_grounded:${citation.sourceTable}:${citation.sourceId}`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Mirrors `validateCopilotAnswer` — validates every citedFact in a proposal against the ground-truth fact list. */
export function validateProposalCitations(
  citedFacts: ActionProposalCitedFact[],
  groundTruth: ActionProposalCitedFact[],
): ProposalCitationValidityResult {
  const errors: string[] = [];
  for (const citation of citedFacts) {
    const result = validateProposalCitation(citation, groundTruth);
    if (!result.valid) errors.push(...result.errors);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Dedup helper used by the factKey — exported for tests that want to assert on grounding-set membership directly. */
export function citedFactKey(f: Pick<ActionProposalCitedFact, "sourceTable" | "sourceId">): string {
  return factKey(f);
}
