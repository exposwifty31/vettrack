import {
  computeBundleReadinessGate,
  isEquipmentFullyDeployable,
} from "../../../../services/equipment-operational-state.service.js";
import type { DeployabilityResolverResult } from "../../copilot/answer.types.js";
import { loadEvidenceGraph } from "../graph.loader.js";
import type { EvidenceGraph, ResolverContext } from "../graph.types.js";
import { claimWithCitations, dedupeCitations, iso, requireGraphEquipment } from "./helpers.js";

function resolveDeployabilityFromGraph(
  ctx: ResolverContext,
  graph: EvidenceGraph,
): DeployabilityResolverResult {
  const eq = requireGraphEquipment(graph, ctx);
  const unknowns: string[] = [];
  const citations = dedupeCitations([]);

  if (!eq) {
    return {
      equipmentId: ctx.equipmentId,
      custodyState: "unknown",
      readinessState: "unknown",
      usageState: "unknown",
      fullDeployable: false,
      bundleGate: {
        ok: false,
        reason: "CUSTODY_CHAIN_BROKEN",
        failedConditions: [],
        staleConditions: [],
        unknownConditions: [],
      },
      asOfMs: ctx.now.getTime(),
      claims: [],
      unknowns: ["equipment_not_found"],
      citations: [],
    };
  }

  const bundleGate = computeBundleReadinessGate(
    { custodyState: eq.custodyState, assetTypeId: eq.assetTypeId },
    graph.unitConditionStates,
    graph.assetTypeConditions,
    ctx.now,
  );

  const fullDeployable = isEquipmentFullyDeployable(
    eq.custodyState,
    eq.readinessState,
    eq.usageState,
  );

  const equipmentCitation = {
    type: "equipment" as const,
    id: eq.id,
    label: eq.name,
    evidence: { observedAt: iso(eq.custodyStateSince ?? ctx.now) },
  };
  citations.push(equipmentCitation);

  const claims = [
    claimWithCitations(
      "custody_state",
      eq.custodyState,
      [equipmentCitation],
      graph,
      ctx.now,
    ),
    claimWithCitations(
      "readiness_state",
      eq.readinessState,
      [equipmentCitation],
      graph,
      ctx.now,
    ),
    claimWithCitations(
      "usage_state",
      eq.usageState,
      [equipmentCitation],
      graph,
      ctx.now,
    ),
    claimWithCitations(
      "full_deployable",
      fullDeployable ? "true" : "false",
      [equipmentCitation],
      graph,
      ctx.now,
    ),
  ];

  if (!bundleGate.ok && bundleGate.reason === "CONDITIONS_NOT_MET") {
    for (const name of bundleGate.failedConditions) {
      unknowns.push(`condition_failed:${name}`);
    }
    for (const name of bundleGate.staleConditions) {
      unknowns.push(`condition_stale:${name}`);
    }
    for (const name of bundleGate.unknownConditions) {
      unknowns.push(`condition_unknown:${name}`);
    }
  }

  return {
    equipmentId: ctx.equipmentId,
    custodyState: eq.custodyState,
    readinessState: eq.readinessState,
    usageState: eq.usageState,
    fullDeployable,
    bundleGate,
    asOfMs: ctx.now.getTime(),
    claims,
    unknowns,
    citations: dedupeCitations(citations),
  };
}

export async function resolveDeployability(
  ctx: ResolverContext,
  graph?: EvidenceGraph,
): Promise<DeployabilityResolverResult> {
  const g = graph ?? (await loadEvidenceGraph(ctx));
  return resolveDeployabilityFromGraph(ctx, g);
}

/** Normalize for semantic deep-equal against HTTP deployability JSON. */
export function normalizeDeployabilityForParity(result: DeployabilityResolverResult): {
  equipmentId: string;
  custodyState: string;
  readinessState: string;
  usageState: string;
  fullDeployable: boolean;
  bundleGate: DeployabilityResolverResult["bundleGate"];
} {
  return {
    equipmentId: result.equipmentId,
    custodyState: result.custodyState,
    readinessState: result.readinessState,
    usageState: result.usageState,
    fullDeployable: result.fullDeployable,
    bundleGate: result.bundleGate,
  };
}
