import type { Citation } from "../../../../../shared/contracts/asset-copilot.v1.js";
import type { LocationResolverResult } from "../../copilot/answer.types.js";
import { loadEvidenceGraph } from "../graph.loader.js";
import type { EvidenceGraph, ResolverContext } from "../graph.types.js";
import { claimWithCitations, dedupeCitations, iso, requireGraphEquipment, roomLabel } from "./helpers.js";

function resolveLocationFromGraph(ctx: ResolverContext, graph: EvidenceGraph): LocationResolverResult {
  const eq = requireGraphEquipment(graph, ctx);
  const unknowns: string[] = [];
  const citations: Citation[] = [];

  if (!eq) {
    return {
      equipmentId: ctx.equipmentId,
      summary: "unknown",
      claims: [],
      unknowns: ["equipment_not_found"],
      citations: [],
    };
  }

  const latestRfid = graph.recentRfidReads[0];
  const latestScan = graph.recentScans[0];
  const latestTransfer = graph.recentTransfers[0];

  if (latestRfid) {
    citations.push({
      type: "rfid",
      id: latestRfid.id,
      label: `RFID read`,
      evidence: { observedAt: iso(latestRfid.readAt) },
    });
  }
  if (latestScan) {
    citations.push({
      type: "scan",
      id: latestScan.id,
      label: `Scan ${latestScan.status}`,
      evidence: { observedAt: iso(latestScan.timestamp) },
    });
  }
  if (latestTransfer) {
    citations.push({
      type: "transfer",
      id: latestTransfer.id,
      label: `Transfer`,
      evidence: { observedAt: iso(latestTransfer.timestamp) },
    });
  }

  if (eq.roomId) {
    const name = roomLabel(graph, eq.roomId);
    citations.push({
      type: "room",
      id: eq.roomId,
      label: name ?? "Room",
      evidence: { observedAt: iso(eq.lastSeen ?? ctx.now) },
    });
  }

  if (eq.dockId) {
    citations.push({
      type: "dock",
      id: eq.dockId,
      label: "Dock",
      evidence: { observedAt: iso(eq.custodyStateSince ?? ctx.now) },
    });
  }

  // Current-anchor station (docking P2): attribute the summary to the anchor's
  // dock. Only the OPEN anchor reaches here (the loader's `invalidated_at IS
  // NULL` filter), so invalidated/superseded anchors contribute nothing.
  if (graph.currentAnchor && graph.currentAnchor.dockId && graph.currentAnchor.dockName) {
    citations.push({
      type: "dock",
      id: graph.currentAnchor.dockId,
      label: graph.currentAnchor.dockName,
      evidence: { observedAt: iso(graph.currentAnchor.assertedAt) },
    });
  }

  citations.push({
    type: "equipment",
    id: eq.id,
    label: eq.name,
    evidence: { observedAt: iso(eq.lastSeen ?? eq.custodyStateSince ?? ctx.now) },
  });

  // Summary precedence (R-M1.0, PINNED — aligned to the inference-service
  // ladder): active checkout > dock station > human-confirmed roomId > RFID
  // last-seen > free-text > unknown. RFID is advisory-only (ADR-006): it
  // corroborates (see citations above) but must NEVER override a
  // human-confirmed room.
  let summary: string;
  if (eq.custodyState === "checked_out" && eq.checkedOutLocation) {
    summary = `checked_out:${eq.checkedOutLocation}`;
  } else if (graph.currentAnchor && graph.currentAnchor.dockName) {
    summary = `dock_station:${graph.currentAnchor.dockName}`;
  } else if (eq.roomId && roomLabel(graph, eq.roomId)) {
    summary = `room:${roomLabel(graph, eq.roomId)}`;
  } else if (latestRfid && roomLabel(graph, latestRfid.toRoomId)) {
    summary = `rfid_room:${roomLabel(graph, latestRfid.toRoomId)}`;
  } else if (eq.location) {
    summary = `location:${eq.location}`;
  } else {
    summary = "unknown";
    unknowns.push("no_authoritative_location");
  }

  const claims = [
    claimWithCitations("location_summary", summary, dedupeCitations(citations), graph, ctx.now),
  ];

  return {
    equipmentId: ctx.equipmentId,
    summary,
    claims,
    unknowns,
    citations: dedupeCitations(citations),
  };
}

export async function resolveCurrentLocation(
  ctx: ResolverContext,
  graph?: EvidenceGraph,
): Promise<LocationResolverResult> {
  const g = graph ?? (await loadEvidenceGraph(ctx));
  return resolveLocationFromGraph(ctx, g);
}
