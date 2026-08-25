import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { invalidateForUser } from "../../../lib/authority-cache.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** PATCH /api/users/:id/role */
export const patchUserRoleHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { role } = req.body as { role: "admin" | "vet" | "technician" | "senior_technician" | "student" };

    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!target) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    if (target.role === "admin" && role !== "admin") {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.clinicId, clinicId), eq(users.role, "admin"), isNull(users.deletedAt)));
      if (count <= 1) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "LAST_ADMIN_DEMOTION_BLOCKED",
            message: "Cannot demote the last admin. Promote another user to admin first.",
            requestId,
          }),
        );
      }
    }

    const [user] = await db
      .update(users)
      .set({ role })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .returning();

    invalidateForUser(clinicId, req.params.id);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_role_changed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { previousRole: target.role, newRole: role, targetEmail: target.email },
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_ROLE_UPDATE_FAILED",
        message: "Failed to update role",
        requestId,
      }),
    );
  }
};
