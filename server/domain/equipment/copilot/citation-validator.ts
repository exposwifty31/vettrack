import type { CopilotAnswer, Citation } from "../../../../shared/contracts/asset-copilot.v1.js";
import type { EvidenceGraph } from "../evidence/graph.types.js";

export type CitationValidityResult =
  | { valid: true }
  | { valid: false; errors: string[] };

const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isValidIso(s: string): boolean {
  if (!ISO_RE.test(s)) {
    const d = new Date(s);
    return !Number.isNaN(d.getTime());
  }
  return !Number.isNaN(new Date(s).getTime());
}

function citationExistsInGraph(citation: Citation, graph: EvidenceGraph): boolean {
  const { clinicId, equipmentId } = graph;
  switch (citation.type) {
    case "equipment":
      return graph.equipment?.id === citation.id && graph.equipment.clinicId === clinicId;
    case "rfid":
      return graph.recentRfidReads.some((r) => r.id === citation.id && r.clinicId === clinicId);
    case "scan":
      return graph.recentScans.some((s) => s.id === citation.id && s.clinicId === clinicId);
    case "transfer":
      return graph.recentTransfers.some((t) => t.id === citation.id && t.clinicId === clinicId);
    case "waitlist":
      return citation.id === `waitlist:${equipmentId}` || graph.waitlist != null;
    case "condition":
      return graph.assetTypeConditions.some((c) => c.id === citation.id && c.clinicId === clinicId);
    case "room":
      return graph.rooms.some((r) => r.id === citation.id && r.clinicId === clinicId);
    case "dock":
      return graph.equipment?.dockId === citation.id;
    case "staging":
      return graph.activeStaging.some((s) => s.id === citation.id && s.clinicId === clinicId);
    case "sse":
      return false;
    default:
      return false;
  }
}

/** Validity only — not semantic relevance (human review). */
export function validateCitation(
  citation: Citation,
  graph: EvidenceGraph,
): CitationValidityResult {
  const errors: string[] = [];
  if (!citation.id?.trim()) errors.push("citation_missing_id");
  if (!citation.label?.trim()) errors.push("citation_missing_label");
  if (!citation.evidence?.observedAt) {
    errors.push("citation_missing_observed_at");
  } else if (!isValidIso(citation.evidence.observedAt)) {
    errors.push("citation_invalid_observed_at");
  }
  if (!citationExistsInGraph(citation, graph)) {
    errors.push(`citation_not_in_graph:${citation.type}:${citation.id}`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateCopilotAnswer(
  answer: CopilotAnswer,
  graph: EvidenceGraph,
): CitationValidityResult {
  const errors: string[] = [];
  for (const citation of answer.citations) {
    const result = validateCitation(citation, graph);
    if (!result.valid) errors.push(...result.errors);
  }
  for (const claim of answer.claims) {
    for (const citation of claim.citations) {
      const result = validateCitation(citation, graph);
      if (!result.valid) errors.push(...result.errors);
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
