import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveApprovalRole } from "../../../lib/approval-role.js";
import { invalidateForUser } from "../../../lib/authority-cache.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** PATCH /api/users/:id/status */
export const patchUserStatusHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status, role: overrideRole } = req.body as {
      status: "pending" | "active" | "blocked";
      role?: "admin" | "vet" | "technician" | "senior_technician" | "student";
    };

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

    // C3: on approval (pending → active), promote to the self-requested role so
    // the admin doesn't re-select it. Vet is gated on a doctor/license number.
    const approval = resolveApprovalRole({
      currentStatus: existing.status,
      newStatus: status,
      requestedRole: existing.requestedRole,
      overrideRole: overrideRole ?? null,
      vetLicenseNumber: existing.vetLicenseNumber,
    });
    if (!approval.ok) {
      return res.status(422).json(
        apiError({
          code: "VET_LICENSE_REQUIRED",
          reason: "VET_LICENSE_REQUIRED",
          message: "A doctor/license number is required to approve a veterinarian",
          requestId,
        }),
      );
    }

    // Guard the update on the status we reviewed: two admins can both observe
    // `pending`, and without this predicate the second write would clobber the
    // first (overwriting a block, or re-granting a role). A null result on a
    // row we already fetched means the status changed concurrently → 409.
    const [user] = await db
      .update(users)
      .set(approval.roleToApply ? { status, role: approval.roleToApply } : { status })
      .where(
        and(
          eq(users.clinicId, clinicId),
          eq(users.id, req.params.id),
          eq(users.status, existing.status),
          isNull(users.deletedAt),
        ),
      )
      .returning();

    if (!user) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "USER_STATUS_CONFLICT",
          message: "User status changed concurrently; reload and retry",
          requestId,
        }),
      );
    }

    // A granted role changes clinical capabilities — drop the authority cache so
    // the new role takes effect immediately (mirrors PATCH /:id/role).
    if (approval.roleToApply) {
      invalidateForUser(clinicId, user.id);
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_status_changed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: {
        previousStatus: existing.status,
        newStatus: status,
        targetEmail: user.email,
        ...(approval.roleToApply ? { grantedRole: approval.roleToApply } : {}),
      },
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_STATUS_UPDATE_FAILED",
        message: "Failed to update status",
        requestId,
      }),
    );
  }
};
