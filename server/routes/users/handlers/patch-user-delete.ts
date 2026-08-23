import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** PATCH /api/users/:id/delete */
export const patchUserDeleteHandler: RequestHandler = async (req, res) => {
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

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

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

    if (existing.role === "admin" && isAdmin && !isSelf) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.clinicId, clinicId), eq(users.role, "admin"), isNull(users.deletedAt)));
      if (count <= 1) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "LAST_ADMIN_DELETE_BLOCKED",
            message: "Cannot delete the last admin. Promote another user to admin first.",
            requestId,
          }),
        );
      }
    }

    const [deleted] = await db
      .update(users)
      .set({ deletedAt: new Date(), deletedBy: actorId })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .returning();

    if (!deleted) {
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
      actionType: "user_deleted",
      performedBy: actorId,
      performedByEmail: req.authUser.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { email: deleted.email, role: deleted.role },
    });

    res.json(deleted);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_DELETE_FAILED",
        message: "Failed to delete user",
        requestId,
      }),
    );
  }
};
