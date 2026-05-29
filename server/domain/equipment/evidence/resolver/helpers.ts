import type { Citation, CopilotClaim } from "../../../../../shared/contracts/asset-copilot.v1.js";
import { buildConfidence } from "../evidence-metadata.js";
import type { EvidenceGraph, ResolverContext } from "../graph.types.js";

export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    const key = `${c.type}:${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function claimWithCitations(
  key: string,
  value: string,
  citations: Citation[],
  graph: EvidenceGraph,
  now: Date,
): CopilotClaim {
  const withConfidence = citations.map((c) => ({
    citation: c,
    confidence: buildConfidence(c, graph, now),
  }));
  const strengths = withConfidence.map((x) => x.confidence.evidenceStrength);
  const freshnesses = withConfidence.map((x) => x.confidence.evidenceFreshness);
  const evidenceStrength = strengths.includes("high")
    ? "high"
    : strengths.includes("medium")
      ? "medium"
      : "low";
  const evidenceFreshness = freshnesses.includes("stale") ? "stale" : "current";

  return {
    key,
    value,
    confidence: { evidenceStrength, evidenceFreshness },
    citations,
  };
}

export function iso(d: Date): string {
  return d.toISOString();
}

export function roomLabel(graph: EvidenceGraph, roomId: string | null): string | null {
  if (!roomId) return null;
  return graph.rooms.find((r) => r.id === roomId)?.name ?? null;
}

export function requireGraphEquipment(
  graph: EvidenceGraph,
  ctx: ResolverContext,
): NonNullable<EvidenceGraph["equipment"]> | null {
  if (!graph.equipment) return null;
  if (graph.equipment.clinicId !== ctx.clinicId || graph.equipment.id !== ctx.equipmentId) {
    return null;
  }
  return graph.equipment;
}
