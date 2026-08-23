import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/**
 * PATCH /api/users/:id/equipment-coordinator
 *
 * P3 T3.4-i-a — admin sets/clears a user's Equipment Coordinator
 * eligibility (`vt_users.is_equipment_coordinator`). Static and
 * manager-set — distinct from `secondaryRole` (a single-valued
 * authority-elevation field); which eligible tech is coordinator for a
 * given shift is derived separately, never stored on this row.
 */
export const patchUserEquipmentCoordinatorHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { isEquipmentCoordinator } = req.body as { isEquipmentCoordinator: boolean };

    const [updated] = await db
      .update(users)
      .set({ isEquipmentCoordinator })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .returning();

    if (!updated) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "equipment_coordinator_eligibility_set",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { isEquipmentCoordinator, targetEmail: updated.email },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EQUIPMENT_COORDINATOR_UPDATE_FAILED",
        message: "Failed to update equipment coordinator eligibility",
        requestId,
      }),
    );
  }
};
