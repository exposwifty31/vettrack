import type { Citation } from "../../../../../shared/contracts/asset-copilot.v1.js";
import type { WaitlistResolverResult } from "../../copilot/answer.types.js";
import { loadEvidenceGraph } from "../graph.loader.js";
import type { EvidenceGraph, ResolverContext } from "../graph.types.js";
import { claimWithCitations, dedupeCitations, iso, requireGraphEquipment } from "./helpers.js";

function resolveWaitlistFromGraph(ctx: ResolverContext, graph: EvidenceGraph): WaitlistResolverResult {
  const eq = requireGraphEquipment(graph, ctx);
  const unknowns: string[] = [];
  const citations: Citation[] = [];

  if (!eq) {
    return {
      equipmentId: ctx.equipmentId,
      claims: [],
      unknowns: ["equipment_not_found"],
      citations: [],
    };
  }

  if (graph.activeStaging.length > 0) {
    const staging = graph.activeStaging[0]!;
    citations.push({
      type: "staging",
      id: staging.id,
      label: "Dock staging queue",
      evidence: { observedAt: iso(staging.stagedAt) },
    });
  }

  const snapshot = graph.waitlist;
  if (!snapshot) {
    unknowns.push("waitlist_snapshot_unavailable");
    return {
      equipmentId: ctx.equipmentId,
      claims: [],
      unknowns,
      citations: dedupeCitations(citations),
    };
  }

  const observedAt = snapshot.entries[0]?.joinedAt ?? ctx.now.toISOString();
  const waitlistCitation: Citation = {
    type: "waitlist",
    id: `waitlist:${ctx.equipmentId}`,
    label: `Waitlist (${snapshot.queueSize} waiting)`,
    evidence: { observedAt },
  };
  citations.push(waitlistCitation);

  const claims: ReturnType<typeof claimWithCitations>[] = [
    claimWithCitations(
      "waitlist_queue_size",
      String(snapshot.queueSize),
      [waitlistCitation],
      graph,
      ctx.now,
    ),
  ];

  if (snapshot.notifiedUserId) {
    claims.push(
      claimWithCitations(
        "waitlist_notified_user",
        snapshot.notifiedUserId,
        [waitlistCitation],
        graph,
        ctx.now,
      ),
    );
  }

  if (ctx.viewerUserId && snapshot.myPosition != null) {
    claims.push(
      claimWithCitations(
        "waitlist_my_position",
        String(snapshot.myPosition),
        [waitlistCitation],
        graph,
        ctx.now,
      ),
    );
  } else if (ctx.viewerUserId) {
    unknowns.push("viewer_not_on_waitlist");
  }

  if (graph.activeStaging.length > 0 && snapshot.queueSize > 0) {
    claims.push(
      claimWithCitations(
        "staging_vs_waitlist",
        "staging_and_waitlist_are_separate",
        dedupeCitations(citations),
        graph,
        ctx.now,
      ),
    );
  }

  return {
    equipmentId: ctx.equipmentId,
    claims,
    unknowns,
    citations: dedupeCitations(citations),
  };
}

export async function resolveWaitlistStatus(
  ctx: ResolverContext,
  graph?: EvidenceGraph,
): Promise<WaitlistResolverResult> {
  const g =
    graph ??
    (await loadEvidenceGraph({
      clinicId: ctx.clinicId,
      equipmentId: ctx.equipmentId,
      viewerUserId: ctx.viewerUserId,
    }));
  return resolveWaitlistFromGraph(ctx, g);
}
