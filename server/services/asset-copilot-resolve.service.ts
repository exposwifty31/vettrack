import {
  ASSET_COPILOT_RESOLVER_VERSION,
  type CopilotAnswer,
} from "../../shared/contracts/asset-copilot.v1.js";
import { loadEvidenceGraph } from "../domain/equipment/evidence/graph.loader.js";
import type { EvidenceGraph } from "../domain/equipment/evidence/graph.types.js";
import { dedupeCitations } from "../domain/equipment/evidence/resolver/helpers.js";
import {
  resolveCurrentLocation,
  resolveCustodian,
  resolveDeployability,
  resolveWaitlistStatus,
} from "../domain/equipment/evidence/resolver/index.js";

export type ResolveCopilotAnswerParams = {
  clinicId: string;
  equipmentId: string;
  viewerUserId?: string;
  now?: Date;
};

export async function resolveCopilotAnswer(
  params: ResolveCopilotAnswerParams,
): Promise<{ answer: CopilotAnswer; graph: EvidenceGraph }> {
  const now = params.now ?? new Date();
  const ctx = {
    clinicId: params.clinicId,
    equipmentId: params.equipmentId,
    now,
    viewerUserId: params.viewerUserId,
  };

  const graph = await loadEvidenceGraph({
    clinicId: params.clinicId,
    equipmentId: params.equipmentId,
    viewerUserId: params.viewerUserId,
  });

  const [location, deployability, custodian, waitlist] = await Promise.all([
    resolveCurrentLocation(ctx, graph),
    resolveDeployability(ctx, graph),
    resolveCustodian(ctx, graph),
    resolveWaitlistStatus(ctx, graph),
  ]);

  const claims = [
    ...deployability.claims,
    ...location.claims,
    ...custodian.claims,
    ...waitlist.claims,
  ];
  const unknowns = [
    ...new Set([
      ...deployability.unknowns,
      ...location.unknowns,
      ...custodian.unknowns,
      ...waitlist.unknowns,
    ]),
  ];
  const citations = dedupeCitations([
    ...deployability.citations,
    ...location.citations,
    ...custodian.citations,
    ...waitlist.citations,
  ]);

  const answer: CopilotAnswer = {
    resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
    equipmentId: params.equipmentId,
    claims,
    unknowns,
    citations,
  };

  return { answer, graph };
}
