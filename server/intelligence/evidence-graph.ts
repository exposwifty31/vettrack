import { randomUUID } from "crypto";
import type { EvidenceGraph, EvidenceNode, EvidenceNodeType } from "../../shared/equipment-intelligence.js";

export class EvidenceGraphBuilder {
  private readonly nodes = new Map<string, EvidenceNode>();
  private readonly edges: EvidenceGraph["edges"] = [];

  addNode(params: {
    type: EvidenceNodeType;
    label: string;
    facts: Record<string, string | number | boolean | null>;
    occurredAt?: Date | string | null;
    relatedIds?: string[];
    stableId?: string;
    idPrefix?: string;
  }): string {
    const id =
      params.stableId ?? `${params.idPrefix ?? params.type}:${randomUUID().slice(0, 12)}`;
    if (this.nodes.has(id)) return id;
    const occurredAt =
      params.occurredAt instanceof Date
        ? params.occurredAt.toISOString()
        : params.occurredAt ?? null;
    this.nodes.set(id, {
      id,
      type: params.type,
      label: params.label,
      facts: params.facts,
      occurredAt,
      relatedIds: params.relatedIds ?? [],
    });
    return id;
  }

  link(from: string, to: string, relation: string): void {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return;
    this.edges.push({ from, to, relation });
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  build(): EvidenceGraph {
    return { nodes: [...this.nodes.values()], edges: [...this.edges] };
  }

  nodeCount(): number {
    return this.nodes.size;
  }
}

export function filterValidEvidenceIds(graph: EvidenceGraph, evidenceIds: string[]): string[] {
  const valid = new Set(graph.nodes.map((n) => n.id));
  return evidenceIds.filter((id) => valid.has(id));
}
