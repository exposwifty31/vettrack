import { randomUUID } from "crypto";
import type {
  IntelligenceConfidence,
  IntelligenceRecommendation,
  IntelligenceSeverity,
} from "../../shared/equipment-intelligence.js";
import type { EquipmentContextSnapshot } from "./context-builder.service.js";
import type { EvidenceGraph } from "../../shared/equipment-intelligence.js";
import { filterValidEvidenceIds } from "./evidence-graph.js";

const SEVERITY_RANK: Record<IntelligenceSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface RawRiskFinding {
  finding: string;
  severity: IntelligenceSeverity;
  confidence: IntelligenceConfidence;
  evidence: string[];
  impact: string;
  recommendedAction: string;
  suggestedTaskType?: "maintenance" | "repair" | "inspection";
  score: number;
}

function scoreFinding(severity: IntelligenceSeverity, confidence: IntelligenceConfidence): number {
  const confWeight = confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
  return SEVERITY_RANK[severity] * 10 + confWeight;
}

export function detectOperationalRisks(
  snapshot: EquipmentContextSnapshot,
  graph: EvidenceGraph,
): RawRiskFinding[] {
  const findings: RawRiskFinding[] = [];
  const nowMs = new Date(snapshot.windowEnd).getTime();

  for (const eq of snapshot.equipment) {
    const eqEvidence = [`equipment:${eq.equipmentId}`];

    if (eq.custodyState === "untracked") {
      findings.push({
        finding: `${eq.name} has broken custody chain (untracked)`,
        severity: "critical",
        confidence: "high",
        evidence: filterValidEvidenceIds(graph, eqEvidence),
        impact: "Asset may be lost or unaccounted for during clinical operations.",
        recommendedAction: "Locate the device, scan to restore custody, or open a recovery investigation task.",
        suggestedTaskType: "inspection",
        score: scoreFinding("critical", "high"),
      });
    }

    if (eq.riskSignals.includes("return_overdue") && eq.checkedOutAt && eq.expectedReturnMinutes) {
      const dueMs = new Date(eq.checkedOutAt).getTime() + eq.expectedReturnMinutes * 60_000;
      const overdueMin = Math.round((nowMs - dueMs) / 60_000);
      findings.push({
        finding: `${eq.name} is overdue for return (${overdueMin} min past expected)`,
        severity: overdueMin > 120 ? "high" : "medium",
        confidence: "high",
        evidence: filterValidEvidenceIds(graph, eqEvidence),
        impact: "Delayed returns reduce availability for the next procedure or patient.",
        recommendedAction: "Contact the checkout holder and schedule immediate return or replacement.",
        suggestedTaskType: "inspection",
        score: scoreFinding(overdueMin > 120 ? "high" : "medium", "high"),
      });
    }

    if (eq.riskSignals.includes("maintenance_overdue") || eq.status === "overdue") {
      findings.push({
        finding: `${eq.name} maintenance is overdue`,
        severity: "high",
        confidence: eq.lastMaintenanceDate ? "high" : "medium",
        evidence: filterValidEvidenceIds(graph, eqEvidence),
        impact: "Overdue maintenance increases clinical and operational failure risk.",
        recommendedAction: "Schedule maintenance verification and document completion.",
        suggestedTaskType: "maintenance",
        score: scoreFinding("high", eq.lastMaintenanceDate ? "high" : "medium"),
      });
    }

    if (eq.riskSignals.includes("not_deployable")) {
      findings.push({
        finding: `${eq.name} is not deployable (readiness: ${eq.readinessState})`,
        severity: "medium",
        confidence: "high",
        evidence: filterValidEvidenceIds(graph, eqEvidence),
        impact: "Staff may assume availability when the unit cannot be safely staged.",
        recommendedAction: "Verify conditions and restore readiness before next checkout.",
        suggestedTaskType: "inspection",
        score: scoreFinding("medium", "high"),
      });
    }

    if (eq.riskSignals.includes("expiry_soon") && eq.expiryDate) {
      findings.push({
        finding: `${eq.name} approaches expiry (${eq.expiryDate})`,
        severity: "medium",
        confidence: "high",
        evidence: filterValidEvidenceIds(graph, eqEvidence),
        impact: "Expired equipment must not enter clinical service.",
        recommendedAction: "Review expiry policy and plan replacement or re-certification.",
        suggestedTaskType: "maintenance",
        score: scoreFinding("medium", "high"),
      });
    }

    if (eq.riskSignals.includes("stale_last_seen") || eq.riskSignals.includes("never_seen")) {
      findings.push({
        finding: `${eq.name} has weak location visibility`,
        severity: "medium",
        confidence: eq.riskSignals.includes("never_seen") ? "medium" : "high",
        evidence: filterValidEvidenceIds(graph, eqEvidence),
        impact: "Missing scans increase search time during urgent needs.",
        recommendedAction: "Perform a room scan or RFID sweep to re-establish last known location.",
        suggestedTaskType: "inspection",
        score: scoreFinding("medium", "high"),
      });
    }
  }

  for (const alertNode of graph.nodes.filter((n) => n.type === "alert")) {
    const equipmentId = String(alertNode.facts.equipmentId ?? "");
    if (!equipmentId) continue;
    const evidence = filterValidEvidenceIds(graph, [alertNode.id, `equipment:${equipmentId}`]);
    if (evidence.length === 0) continue;
    findings.push({
      finding: `Unresolved alert on equipment (${alertNode.facts.alertType})`,
      severity: "high",
      confidence: "high",
      evidence,
      impact: "Open alerts indicate known issues that may still affect operations.",
      recommendedAction: "Review alert on the equipment record and resolve or escalate.",
      suggestedTaskType: "inspection",
      score: scoreFinding("high", "high"),
    });
  }

  for (const wlNode of graph.nodes.filter((n) => n.type === "waitlist")) {
    const equipmentId = String(wlNode.facts.equipmentId ?? "");
    const evidence = filterValidEvidenceIds(graph, [wlNode.id, `equipment:${equipmentId}`]);
    if (evidence.length === 0) continue;
    findings.push({
      finding: `Staff waiting for equipment (${equipmentId})`,
      severity: "medium",
      confidence: "high",
      evidence,
      impact: "Waitlist pressure signals demand exceeding available custody.",
      recommendedAction: "Prioritize return or substitute unit for waiting technician.",
      suggestedTaskType: "inspection",
      score: scoreFinding("medium", "high"),
    });
  }

  for (const retNode of graph.nodes.filter((n) => n.type === "return" && n.facts.isPluggedIn === false)) {
    const equipmentId = String(retNode.facts.equipmentId ?? "");
    const evidence = filterValidEvidenceIds(graph, [retNode.id, `equipment:${equipmentId}`]);
    if (evidence.length === 0) continue;
    findings.push({
      finding: `Recent return without plug-in confirmation`,
      severity: "medium",
      confidence: "high",
      evidence,
      impact: "Unplugged returns may trigger charge or readiness issues.",
      recommendedAction: "Verify plug-in status and update return record.",
      suggestedTaskType: "inspection",
      score: scoreFinding("medium", "high"),
    });
  }

  return findings
    .filter((f) => f.evidence.length > 0)
    .sort((a, b) => b.score - a.score);
}

export function toRecommendations(findings: RawRiskFinding[], limit = 5): IntelligenceRecommendation[] {
  return findings.slice(0, limit).map((f) => ({
    id: randomUUID(),
    finding: f.finding,
    severity: f.severity,
    confidence: f.confidence,
    evidence: f.evidence,
    impact: f.impact,
    recommendedAction: f.recommendedAction,
    approvalRequired: true as const,
    suggestedTaskType: f.suggestedTaskType,
  }));
}

export function hasActionableEvidence(
  snapshot: EquipmentContextSnapshot,
  graph: EvidenceGraph,
  findings: RawRiskFinding[],
): boolean {
  if (findings.length > 0) return true;
  if (snapshot.equipmentCount === 0) return false;
  return graph.nodes.length > 0 && snapshot.equipment.some((e) => e.riskSignals.length > 0);
}
