import type { Citation } from "../../../../../shared/contracts/asset-copilot.v1.js";
import type { CustodianResolverResult } from "../../copilot/answer.types.js";
import { isCustodyAssertionCurrent } from "../supersession.js";
import { loadEvidenceGraph } from "../graph.loader.js";
import type { EvidenceGraph, ResolverContext } from "../graph.types.js";
import { claimWithCitations, dedupeCitations, iso, requireGraphEquipment } from "./helpers.js";

function resolveCustodianFromGraph(ctx: ResolverContext, graph: EvidenceGraph): CustodianResolverResult {
  const eq = requireGraphEquipment(graph, ctx);
  const unknowns: string[] = [];
  const citations: Citation[] = [];

  if (!eq) {
    return {
      equipmentId: ctx.equipmentId,
      claims: [],
      unknowns: ["equipment_not_found"],
      citations: [],
      lastCorroboratedAt: null,
    };
  }

  const custodyCurrent = isCustodyAssertionCurrent(eq, graph.supersessionEvents);

  if (!custodyCurrent || eq.custodyState !== "checked_out" || !eq.checkedOutById) {
    unknowns.push("no_active_custodian");
    return {
      equipmentId: ctx.equipmentId,
      claims: [
        claimWithCitations("custodian", "none", [], graph, ctx.now),
      ],
      unknowns,
      citations: [],
      lastCorroboratedAt: null,
    };
  }

  const equipmentCitation: Citation = {
    type: "equipment",
    id: eq.id,
    label: eq.name,
    evidence: { observedAt: iso(eq.checkedOutAt ?? eq.custodyStateSince ?? ctx.now) },
  };
  citations.push(equipmentCitation);

  const custodianLabel = eq.checkedOutByEmail ?? eq.checkedOutById;
  const claims = [
    claimWithCitations("custodian", custodianLabel, [equipmentCitation], graph, ctx.now),
    claimWithCitations("custody_state", "checked_out", [equipmentCitation], graph, ctx.now),
  ];

  const corroboratingScan = graph.recentScans.find(
    (s) => s.status === "checked_out" || s.status === "checkout",
  );
  const corroboratingRfid = graph.recentRfidReads[0];
  let lastCorroboratedAt: string | null = null;

  if (corroboratingScan) {
    const scanCitation: Citation = {
      type: "scan",
      id: corroboratingScan.id,
      label: "Checkout scan",
      evidence: { observedAt: iso(corroboratingScan.timestamp) },
    };
    citations.push(scanCitation);
    lastCorroboratedAt = scanCitation.evidence.observedAt;
  } else if (corroboratingRfid) {
    const rfidCitation: Citation = {
      type: "rfid",
      id: corroboratingRfid.id,
      label: "RFID corroboration",
      evidence: { observedAt: iso(corroboratingRfid.readAt) },
    };
    citations.push(rfidCitation);
    lastCorroboratedAt = rfidCitation.evidence.observedAt;
  }

  return {
    equipmentId: ctx.equipmentId,
    claims,
    unknowns,
    citations: dedupeCitations(citations),
    lastCorroboratedAt,
  };
}

export async function resolveCustodian(
  ctx: ResolverContext,
  graph?: EvidenceGraph,
): Promise<CustodianResolverResult> {
  const g = graph ?? (await loadEvidenceGraph(ctx));
  return resolveCustodianFromGraph(ctx, g);
}
