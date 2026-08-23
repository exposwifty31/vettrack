import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** PATCH /api/users/:id/secondary-role */
export const patchUserSecondaryRoleHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { secondaryRole } = req.body as { secondaryRole: "technician" | "senior_technician" | "admin" | null };

    await db
      .update(users)
      .set({ secondaryRole })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)));

    const [updated] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

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
      actionType: "user_secondary_role_changed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { newSecondaryRole: secondaryRole, targetEmail: updated.email },
    });

    return res.json({ user: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_SECONDARY_ROLE_UPDATE_FAILED",
        message: "Failed to update secondary role",
        requestId,
      }),
    );
  }
};
