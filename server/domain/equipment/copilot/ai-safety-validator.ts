import type { CopilotAnswer } from "../../../../shared/contracts/asset-copilot.v1.js";
import type { EvidenceGraph } from "../evidence/graph.types.js";
import { validateCopilotAnswer, type CitationValidityResult } from "./citation-validator.js";

const FINANCIAL_CLAIM_RE =
  /\b(saves?\s+\$|roi\b|guaranteed\s+savings|actual\s+roi|revenue\s+increase|cost\s+reduction)\b/i;

const MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AiSafetyValidationResult =
  | { safe: true }
  | { safe: false; errors: string[]; uncertainty?: string[] };

/** PR16: structured output safety beyond citation validity. */
export function validateCopilotAnswerSafety(
  answer: CopilotAnswer,
  graph: EvidenceGraph,
  now: Date = new Date(),
): AiSafetyValidationResult {
  const errors: string[] = [];
  const uncertainty: string[] = [];

  const citationResult: CitationValidityResult = validateCopilotAnswer(answer, graph);
  if (!citationResult.valid) errors.push(...citationResult.errors);

  for (const claim of answer.claims) {
    if (!claim.citations?.length) {
      errors.push("claim_missing_citation_support");
    }
    if (FINANCIAL_CLAIM_RE.test(claim.value ?? "")) {
      errors.push("financial_claim_without_cost_evidence");
    }
    for (const citation of claim.citations) {
      const observedAt = citation.evidence?.observedAt;
      if (observedAt) {
        const age = now.getTime() - new Date(observedAt).getTime();
        if (age > MAX_EVIDENCE_AGE_MS) {
          uncertainty.push(`stale_evidence:${citation.type}:${citation.id}`);
        }
      }
      if (!["equipment", "rfid", "scan", "transfer", "room", "condition", "dock", "staging", "waitlist"].includes(citation.type)) {
        errors.push(`unsupported_evidence_type:${citation.type}`);
      }
    }
  }

  if (errors.length > 0) return { safe: false, errors, uncertainty };
  return { safe: true, ...(uncertainty.length > 0 ? { uncertainty } : {}) };
}
