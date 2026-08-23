import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/**
 * PATCH /api/users/:id/senior-doctor-eligible
 *
 * Doctor shift gate (spec 2026-08-13) — admin sets/clears a user's
 * static eligibility to mark themselves as the responsible senior of a
 * doctor team at check-in (`vt_users.senior_doctor_eligible`). Mirrors
 * the equipment-coordinator eligibility handler. Which team a senior
 * leads is chosen per check-in, never stored on this row. Distinct from
 * `secondaryRole` (account RBAC — never consulted by the clinical path).
 */
export const patchUserSeniorDoctorEligibleHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { seniorDoctorEligible } = req.body as { seniorDoctorEligible: boolean };

    const [updated] = await db
      .update(users)
      .set({ seniorDoctorEligible })
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
      actionType: "senior_doctor_eligible_set",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { seniorDoctorEligible, targetEmail: updated.email },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SENIOR_DOCTOR_ELIGIBLE_UPDATE_FAILED",
        message: "Failed to update senior doctor eligibility",
        requestId,
      }),
    );
  }
};
