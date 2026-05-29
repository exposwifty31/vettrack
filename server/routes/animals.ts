import { Router } from "express";
import { randomUUID } from "crypto";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { animals, appointments, db } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";

const router = Router();

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incoming: unknown,
): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

/**
 * GET /api/animals/active
 * Returns unique animals with appointments scheduled today (not cancelled).
 * Used by DispenseSheet to populate patient selection.
 */
router.get("/active", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    const rows = await db
      .selectDistinctOn([appointments.animalId], {
        animalId: appointments.animalId,
        animalName: animals.name,
        species: animals.species,
        breed: animals.breed,
      })
      .from(appointments)
      .innerJoin(animals, eq(appointments.animalId, animals.id))
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          isNull(animals.deletedAt),
          isNotNull(appointments.animalId),
          ne(appointments.status, "cancelled"),
          sql`DATE_TRUNC('day', ${appointments.startTime}) = DATE_TRUNC('day', NOW())`,
        ),
      );

    const result = rows
      .filter((r) => r.animalId !== null)
      .map((r) => ({
        animalId: r.animalId as string,
        animalName: r.animalName || "מטופל ללא שם",
        species: r.species ?? null,
        breed: r.breed ?? null,
      }));

    res.json({ animals: result });
  } catch (err) {
    console.error("[animals] active fetch failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ANIMALS_ACTIVE_FAILED",
        message: "Failed to load active patients",
        requestId,
      }),
    );
  }
});

export default router;
