/**
 * Asset Copilot wire contracts (v1).
 * Safe for client + server import. Citations store observedAt only — no cached ageMinutes.
 */

export const ASSET_COPILOT_RESOLVER_VERSION = "v1.0.0-m0" as const;

export type CitationType =
  | "equipment"
  | "rfid"
  | "scan"
  | "transfer"
  | "sse"
  | "waitlist"
  | "condition"
  | "room"
  | "dock"
  | "staging";

export interface Citation {
  type: CitationType;
  id: string;
  label: string;
  /** observedAt only — age/freshness recomputed on serve (plan §3.6). */
  evidence: { observedAt: string };
}

export interface Confidence {
  evidenceStrength: "low" | "medium" | "high";
  evidenceFreshness: "current" | "stale";
}

export interface CopilotClaim {
  key: string;
  value: string;
  confidence: Confidence;
  citations: Citation[];
}

export interface CopilotAnswer {
  resolverVersion: typeof ASSET_COPILOT_RESOLVER_VERSION;
  equipmentId: string;
  claims: CopilotClaim[];
  unknowns: string[];
  /** Flat deduplicated list for validator convenience. */
  citations: Citation[];
}

/** POST /api/equipment/:id/copilot/explain — resolver-grounded + optional Claude narrative. */
export interface CopilotExplainResponse {
  answer: CopilotAnswer;
  narrative: string;
  llmUsed: boolean;
  validationFailed: boolean;
}
