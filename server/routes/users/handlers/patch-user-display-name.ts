import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { invalidateForUser } from "../../../lib/authority-cache.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";
import { param } from "../../../lib/route-params.js";

/** PATCH /api/users/:id/display_name */
export const patchUserDisplayNameHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const idParam = param(req, "id");
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

    const { display_name } = req.body as { display_name: string };
    const actorId = req.authUser.id;

    if (actorId !== idParam && req.authUser.role !== "admin") {
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
      .where(and(eq(users.clinicId, clinicId), eq(users.id, idParam), isNull(users.deletedAt)))
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

    const [updated] = await db
      .update(users)
      .set({ displayName: display_name })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, idParam)))
      .returning();

    invalidateForUser(clinicId, idParam);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_display_name_changed",
      performedBy: actorId,
      performedByEmail: req.authUser.email,
      targetId: idParam,
      targetType: "user",
      metadata: {
        field: "display_name",
        previousDisplayName: existing.displayName,
        newDisplayName: updated.displayName,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_DISPLAY_NAME_UPDATE_FAILED",
        message: "Failed to update display name",
        requestId,
      }),
    );
  }
};
