import { Router } from "express";
import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, equipment, damageEvents } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limiters.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { pgUpdateMatchedZeroRows } from "../lib/pg-result.js";
import { apiError, resolveRequestId } from "./equipment/equipment-route-utils.js";

/** Non-"ok" condition value applied to equipment on a damage report (R-EQ-F3). */
const DAMAGED_CONDITION_STATUS = "damaged";

/** Max stored length for the free-text damage note. */
const NOTE_MAX_LENGTH = 2000;

const router = Router();

// POST /api/equipment/:id/damage
// Records a damage report for a clinic-scoped equipment item and flips its
// conditionStatus to a non-"ok" value in the same transaction. clinicId is
// always read from the authenticated request context — never from the
// request body or params.
router.post("/:id/damage", requireAuth, writeLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId;
  const equipmentId = req.params.id;

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

  // requireAuth guarantees authUser is populated for active users; narrow once
  // here instead of asserting `!` at each use site below.
  const authUser = req.authUser;
  if (!authUser) {
    res.status(401).json(
      apiError({ code: "UNAUTHORIZED", reason: "UNAUTHORIZED", message: "Unauthorized", requestId }),
    );
    return;
  }

  const rawNote = (req.body as { note?: unknown } | undefined)?.note;
  const note = typeof rawNote === "string" && rawNote.trim().length > 0
    ? rawNote.trim().slice(0, NOTE_MAX_LENGTH)
    : null;

  try {
    const [existing] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(
        and(
          eq(equipment.clinicId, clinicId),
          eq(equipment.id, equipmentId),
          isNull(equipment.deletedAt),
        ),
      )
      .limit(1);

    if (!existing) {
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

    const damageEventId = randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      // Guard against a soft-delete landing between the preflight SELECT
      // above and this UPDATE: if the row no longer matches, abort the whole
      // transaction (including the damage-event insert below) instead of
      // recording a damage event for an equipment row that was never flipped.
      const updateResult = await tx
        .update(equipment)
        .set({ conditionStatus: DAMAGED_CONDITION_STATUS, version: sql`${equipment.version} + 1` })
        .where(
          and(
            eq(equipment.clinicId, clinicId),
            eq(equipment.id, equipmentId),
            isNull(equipment.deletedAt),
          ),
        );

      if (pgUpdateMatchedZeroRows(updateResult)) {
        throw new Error("EQUIPMENT_NOT_FOUND");
      }

      await tx.insert(damageEvents).values({
        id: damageEventId,
        clinicId,
        equipmentId,
        reportedBy: authUser.id,
        at: now,
        note,
      });
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_damage_reported",
      performedBy: authUser.id,
      performedByEmail: authUser.email,
      targetId: equipmentId,
      targetType: "equipment",
      metadata: { damageEventId, note },
    });

    res.status(201).json({
      damageEvent: {
        id: damageEventId,
        equipmentId,
        reportedBy: authUser.id,
        at: now.toISOString(),
        note,
      },
      conditionStatus: DAMAGED_CONDITION_STATUS,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "EQUIPMENT_NOT_FOUND") {
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
    console.error("[equipment-damage] report failed", {
      at: new Date().toISOString(),
      clinicId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "DAMAGE_REPORT_FAILED",
        message: "Could not report damage",
        requestId,
      }),
    );
  }
});

export default router;
