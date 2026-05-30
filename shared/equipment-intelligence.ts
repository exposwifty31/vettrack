/** Shared contracts — VetTrack Equipment Intelligence Engine (MVP). */

export type IntelligenceConfidence = "low" | "medium" | "high";
export type IntelligenceSeverity = "critical" | "high" | "medium" | "low";

export type EvidenceNodeType =
  | "equipment"
  | "scan"
  | "return"
  | "transfer"
  | "room"
  | "user"
  | "alert"
  | "waitlist"
  | "audit"
  | "billing"
  | "maintenance"
  | "metric";

export interface EvidenceNode {
  id: string;
  type: EvidenceNodeType;
  label: string;
  facts: Record<string, string | number | boolean | null>;
  occurredAt: string | null;
  relatedIds: string[];
}

export interface EvidenceGraph {
  nodes: EvidenceNode[];
  edges: Array<{ from: string; to: string; relation: string }>;
}

export interface IntelligenceRecommendation {
  id: string;
  finding: string;
  severity: IntelligenceSeverity;
  confidence: IntelligenceConfidence;
  evidence: string[];
  impact: string;
  recommendedAction: string;
  approvalRequired: true;
  suggestedTaskType?: "maintenance" | "repair" | "inspection";
}

export interface IntelligenceAnalysisResponse {
  runId: string;
  generatedAt: string;
  executiveSummary: string;
  topRisks: IntelligenceRecommendation[];
  evidence: EvidenceGraph;
  recommendedActions: Array<{ recommendationId: string; action: string }>;
  confidenceLevels: Array<{ recommendationId: string; confidence: IntelligenceConfidence }>;
  insufficientEvidence: boolean;
  insufficientEvidenceMessage?: string;
}

export interface ShiftHandoverIntelligenceResponse {
  runId: string;
  generatedAt: string;
  executiveSummary: string;
  criticalIssues: IntelligenceRecommendation[];
  openRisks: IntelligenceRecommendation[];
  unresolvedProblems: IntelligenceRecommendation[];
  equipmentConcerns: IntelligenceRecommendation[];
  recommendedFollowUps: IntelligenceRecommendation[];
  evidence: EvidenceGraph;
  insufficientEvidence: boolean;
  insufficientEvidenceMessage?: string;
}

export const INSUFFICIENT_EVIDENCE_MESSAGE =
  "Insufficient evidence available to determine a reliable conclusion.";
