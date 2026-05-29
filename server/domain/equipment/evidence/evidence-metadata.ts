import type {
  Citation,
  CitationType,
  Confidence,
} from "../../../../shared/contracts/asset-copilot.v1.js";
import type { EvidenceGraph } from "./graph.types.js";
import { isCustodyAssertionCurrent } from "./supersession.js";

/** Observation decay windows (minutes) — plan §3.5-A */
export const OBSERVATION_FRESHNESS_MAX_MINUTES: Partial<Record<CitationType, number>> = {
  rfid: 240,
  scan: 120,
  transfer: 120,
  sse: 30,
  waitlist: 15,
};

type FreshnessMode = "observation_decay" | "state_assertion" | "condition_lifecycle";

function freshnessModeForCitationType(type: CitationType): FreshnessMode {
  if (type === "equipment") return "state_assertion";
  if (type === "condition") return "condition_lifecycle";
  if (type in OBSERVATION_FRESHNESS_MAX_MINUTES) return "observation_decay";
  return "observation_decay";
}

export function ageMinutes(observedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - observedAt.getTime()) / 60_000));
}

function observationFreshness(
  type: CitationType,
  observedAt: Date,
  now: Date,
): Confidence["evidenceFreshness"] {
  const maxMin = OBSERVATION_FRESHNESS_MAX_MINUTES[type];
  if (maxMin == null) return "current";
  return ageMinutes(observedAt, now) <= maxMin ? "current" : "stale";
}

function conditionFreshness(
  citation: Citation,
  graph: EvidenceGraph,
  now: Date,
): Confidence["evidenceFreshness"] {
  const condition = graph.assetTypeConditions.find((c) => c.id === citation.id);
  if (!condition) return "stale";
  const state = graph.unitConditionStates.find((s) => s.conditionId === condition.id);
  if (!state?.verifiedAt) return "stale";
  const age = ageMinutes(state.verifiedAt, now);
  return age <= condition.staleAfterMinutes ? "current" : "stale";
}

function equipmentCustodyFreshness(graph: EvidenceGraph): Confidence["evidenceFreshness"] {
  const eq = graph.equipment;
  if (!eq) return "stale";
  return isCustodyAssertionCurrent(eq, graph.supersessionEvents) ? "current" : "stale";
}

/** Recompute freshness at serve/render time — never cache ageMinutes or labels. */
export function resolveEvidenceFreshness(
  citation: Citation,
  graph: EvidenceGraph,
  now: Date,
): Confidence["evidenceFreshness"] {
  const mode = freshnessModeForCitationType(citation.type);
  const observedAt = new Date(citation.evidence.observedAt);
  if (Number.isNaN(observedAt.getTime())) return "stale";

  switch (mode) {
    case "state_assertion":
      return equipmentCustodyFreshness(graph);
    case "condition_lifecycle":
      return conditionFreshness(citation, graph, now);
    case "observation_decay":
    default:
      return observationFreshness(citation.type, observedAt, now);
  }
}

function defaultStrengthForCitationType(type: CitationType): Confidence["evidenceStrength"] {
  switch (type) {
    case "equipment":
    case "condition":
      return "high";
    case "rfid":
    case "scan":
      return "medium";
    case "transfer":
    case "waitlist":
      return "medium";
    default:
      return "low";
  }
}

export function buildConfidence(
  citation: Citation,
  graph: EvidenceGraph,
  now: Date,
  strengthOverride?: Confidence["evidenceStrength"],
): Confidence {
  return {
    evidenceStrength: strengthOverride ?? defaultStrengthForCitationType(citation.type),
    evidenceFreshness: resolveEvidenceFreshness(citation, graph, now),
  };
}

