import { createOpenAiClient, resolveOpenAiModel } from "./openai-client.js";
import type { EquipmentContextSnapshot } from "./context-builder.service.js";
import type { EvidenceGraph, IntelligenceRecommendation } from "../../shared/equipment-intelligence.js";
import {
  detectOperationalRisks,
  hasActionableEvidence,
  toRecommendations,
  type RawRiskFinding,
} from "./risk-detector.js";
import { INSUFFICIENT_EVIDENCE_MESSAGE } from "../../shared/equipment-intelligence.js";

export interface IntelligenceEngineResult {
  executiveSummary: string;
  recommendations: IntelligenceRecommendation[];
  insufficientEvidence: boolean;
  insufficientEvidenceMessage?: string;
  openaiModel: string | null;
  rawFindings: RawRiskFinding[];
}

async function synthesizeExecutiveSummary(params: {
  snapshot: EquipmentContextSnapshot;
  graph: EvidenceGraph;
  findings: RawRiskFinding[];
  mode: "analyze" | "shift_handover";
}): Promise<{ summary: string; model: string | null }> {
  const client = createOpenAiClient();
  if (!client || params.findings.length === 0) {
    const count = params.findings.length;
    if (count === 0) {
      return {
        summary:
          params.snapshot.equipmentCount === 0
            ? "No active equipment records were found for this clinic."
            : "No prioritized operational risks were detected in the current evidence window.",
        model: null,
      };
    }
    return {
      summary: `${count} operational risk(s) identified from verified equipment evidence.`,
      model: null,
    };
  }

  const model = resolveOpenAiModel();
  const payload = {
    mode: params.mode,
    window: { start: params.snapshot.windowStart, end: params.snapshot.windowEnd },
    metrics: params.snapshot.metrics,
    equipmentCount: params.snapshot.equipmentCount,
    findings: params.findings.slice(0, 8).map((f) => ({
      finding: f.finding,
      severity: f.severity,
      confidence: f.confidence,
      impact: f.impact,
      evidence: f.evidence,
    })),
    evidenceNodeCount: params.graph.nodes.length,
  };

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You summarize veterinary hospital equipment operational risks. Use ONLY the findings and metrics in the user JSON. Do not invent equipment, events, or causes. Do not add new risks. Output JSON: { \"executiveSummary\": string } with 2-4 sentences.",
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { executiveSummary?: string };
    const summary =
      typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim().length > 0
        ? parsed.executiveSummary.trim()
        : `${params.findings.length} operational risk(s) identified from verified evidence.`;
    return { summary, model };
  } catch (err) {
    console.error("[equipment-intelligence] OpenAI synthesis failed", err);
    return {
      summary: `${params.findings.length} operational risk(s) identified from verified equipment evidence (narrative synthesis unavailable).`,
      model,
    };
  }
}

export async function runEquipmentIntelligenceEngine(params: {
  snapshot: EquipmentContextSnapshot;
  graph: EvidenceGraph;
  mode: "analyze" | "shift_handover";
  topLimit?: number;
}): Promise<IntelligenceEngineResult> {
  const rawFindings = detectOperationalRisks(params.snapshot, params.graph);
  const actionable = hasActionableEvidence(params.snapshot, params.graph, rawFindings);

  if (!actionable) {
    return {
      executiveSummary: INSUFFICIENT_EVIDENCE_MESSAGE,
      recommendations: [],
      insufficientEvidence: true,
      insufficientEvidenceMessage: INSUFFICIENT_EVIDENCE_MESSAGE,
      openaiModel: null,
      rawFindings: [],
    };
  }

  const recommendations = toRecommendations(rawFindings, params.topLimit ?? 5);
  const { summary, model } = await synthesizeExecutiveSummary({
    snapshot: params.snapshot,
    graph: params.graph,
    findings: rawFindings,
    mode: params.mode,
  });

  return {
    executiveSummary: summary,
    recommendations,
    insufficientEvidence: false,
    openaiModel: model,
    rawFindings,
  };
}

export function partitionShiftHandoverRecommendations(
  recommendations: IntelligenceRecommendation[],
): {
  criticalIssues: IntelligenceRecommendation[];
  openRisks: IntelligenceRecommendation[];
  unresolvedProblems: IntelligenceRecommendation[];
  equipmentConcerns: IntelligenceRecommendation[];
  recommendedFollowUps: IntelligenceRecommendation[];
} {
  const criticalIssues = recommendations.filter(
    (r) => r.severity === "critical" || r.severity === "high",
  );
  const openRisks = recommendations.filter((r) => r.severity === "medium");
  const unresolvedProblems = recommendations.filter((r) =>
    r.finding.toLowerCase().includes("alert") || r.finding.toLowerCase().includes("unresolved"),
  );
  const equipmentConcerns = recommendations.filter((r) =>
    r.finding.toLowerCase().includes("equipment") ||
    r.finding.toLowerCase().includes("custody") ||
    r.finding.toLowerCase().includes("deployable"),
  );
  const recommendedFollowUps = recommendations.map((r) => ({ ...r }));

  return {
    criticalIssues: criticalIssues.slice(0, 5),
    openRisks: openRisks.slice(0, 5),
    unresolvedProblems: unresolvedProblems.slice(0, 5),
    equipmentConcerns: equipmentConcerns.slice(0, 5),
    recommendedFollowUps: recommendedFollowUps.slice(0, 5),
  };
}
