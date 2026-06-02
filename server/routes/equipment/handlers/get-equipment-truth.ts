import type { Request, Response } from "express";
import { loadEvidenceGraph } from "../../../domain/equipment/evidence/graph.loader.js";
import type { ResolverContext } from "../../../domain/equipment/evidence/graph.types.js";
import {
  resolveCurrentLocation,
  resolveCustodian,
  resolveDeployability,
} from "../../../domain/equipment/evidence/resolver/index.js";
import { dedupeCitations } from "../../../domain/equipment/evidence/resolver/helpers.js";
import { ASSET_COPILOT_RESOLVER_VERSION } from "../../../../shared/equipment-truth.js";
import type { EquipmentTruthResponse } from "../../../../shared/equipment-truth.js";
import { apiError, resolveRequestId } from "../equipment-route-utils.js";

export async function getEquipmentTruthHandler(req: Request, res: Response): Promise<void> {
  const clinicId = req.clinicId;
  const equipmentId = req.params.id;

  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  if (!clinicId) {
    res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "UNAUTHORIZED",
        message: "Unauthorized",
        requestId,
      }),
    );
    return;
  }

  const ctx: ResolverContext = {
    clinicId,
    equipmentId,
    now: new Date(),
    viewerUserId: req.authUser?.id,
  };

  const graph = await loadEvidenceGraph(ctx);
  if (!graph.equipment) {
    res.status(404).json(
      apiError({
        code: "NOT_FOUND",
        reason: "EQUIPMENT_NOT_FOUND",
        message: "Equipment not found",
        requestId,
      }),
    );
    return;
  }

  const [location, deployability, custodian] = await Promise.all([
    resolveCurrentLocation(ctx, graph),
    resolveDeployability(ctx, graph),
    resolveCustodian(ctx, graph),
  ]);

  const citations = dedupeCitations([
    ...location.citations,
    ...deployability.citations,
    ...custodian.citations,
  ]);

  const body: EquipmentTruthResponse = {
    equipmentId,
    resolverVersion: ASSET_COPILOT_RESOLVER_VERSION,
    asOfMs: deployability.asOfMs,
    location: {
      summary: location.summary,
      claims: location.claims,
      unknowns: location.unknowns,
    },
    deployability: {
      fullDeployable: deployability.fullDeployable,
      custodyState: deployability.custodyState,
      readinessState: deployability.readinessState,
      usageState: deployability.usageState,
      bundleGate: deployability.bundleGate,
      claims: deployability.claims,
      unknowns: deployability.unknowns,
    },
    custodian: {
      claims: custodian.claims,
      unknowns: custodian.unknowns,
      lastCorroboratedAt: custodian.lastCorroboratedAt,
    },
    citations,
  };

  res.json(body);
}
