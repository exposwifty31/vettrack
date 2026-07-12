import { Router } from "express";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { db, equipment } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { scanLimiter } from "../middleware/rate-limiters.js";
import { loadEvidenceGraph } from "../domain/equipment/evidence/graph.loader.js";
import type { ResolverContext } from "../domain/equipment/evidence/graph.types.js";
import { resolveCurrentLocation, resolveCustodian } from "../domain/equipment/evidence/resolver/index.js";
import { apiError, resolveRequestId } from "./equipment/equipment-route-utils.js";

/** Read-only search — caps how many evidence graphs a single request resolves. */
const LOCATE_MATCH_LIMIT = 10;

const router = Router();

// GET /api/equipment/locate?q=<query>
// Read-only: composes the existing location + custodian evidence resolvers for
// every clinic-scoped equipment row matching `q`. No writes, no schema, no audit.
router.get("/locate", requireAuth, scanLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

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

  if (!q) {
    res.status(400).json(
      apiError({
        code: "BAD_REQUEST",
        reason: "MISSING_QUERY",
        message: "Query is required",
        requestId,
      }),
    );
    return;
  }

  try {
    const pattern = `%${q}%`;
    const matches = await db
      .select({ id: equipment.id, name: equipment.name })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          isNull(equipment.deletedAt),
          or(
            ilike(equipment.name, pattern),
            ilike(equipment.serialNumber, pattern),
            ilike(equipment.model, pattern),
            ilike(equipment.manufacturer, pattern),
            ilike(equipment.searchAlias, pattern),
          ),
        ),
      )
      .limit(LOCATE_MATCH_LIMIT);

    const results = await Promise.all(
      matches.map(async (match) => {
        const ctx: ResolverContext = { clinicId, equipmentId: match.id, now: new Date() };
        const graph = await loadEvidenceGraph(ctx);
        const [location, custodian] = await Promise.all([
          resolveCurrentLocation(ctx, graph),
          resolveCustodian(ctx, graph),
        ]);

        return {
          equipmentId: match.id,
          name: match.name,
          location: {
            summary: location.summary,
            claims: location.claims,
            unknowns: location.unknowns,
          },
          custodian: {
            claims: custodian.claims,
            unknowns: custodian.unknowns,
            lastCorroboratedAt: custodian.lastCorroboratedAt,
          },
          readiness: graph.equipment?.readinessState ?? "unknown",
        };
      }),
    );

    res.json({ query: q, results });
  } catch (err) {
    console.error("[equipment-locate] search failed", {
      at: new Date().toISOString(),
      clinicId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "LOCATE_SEARCH_FAILED",
        message: "Could not locate equipment",
        requestId,
      }),
    );
  }
});

export default router;
