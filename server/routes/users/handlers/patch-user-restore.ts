import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNotNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** PATCH /api/users/:id/restore */
export const patchUserRestoreHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!req.authUser) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    const clinicId = req.clinicId!;

    const actorId = req.authUser.id;
    const isSelf = actorId === req.params.id;
    const isAdmin = req.authUser.role === "admin";
    if (!isSelf && !isAdmin) {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "INSUFFICIENT_ROLE",
          message: "Forbidden",
          requestId,
        }),
      );
    }

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNotNull(users.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND_OR_NOT_DELETED",
          message: "User not found or not deleted",
          requestId,
        }),
      );
    }

    const [restored] = await db
      .update(users)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id)))
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_restored",
      performedBy: actorId,
      performedByEmail: req.authUser.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { email: restored.email, role: restored.role },
    });

    res.json(restored);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_RESTORE_FAILED",
        message: "Failed to restore user",
        requestId,
      }),
    );
  }
};
