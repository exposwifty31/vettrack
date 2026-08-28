import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { resolveRequestId, apiError } from "../users-route-utils.js";

// Returns eligible managers (vet/admin) for the Code Blue manager picker.
// All authenticated staff can see this list since they may need to designate a manager.
/** GET /api/users/managers */
export const getUsersManagersHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const managers = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
          sql`${users.role} IN ('vet', 'admin')`,
        ),
      )
      .orderBy(users.name);
    res.json({ managers });
  } catch (err) {
    console.error("users:managers", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_MANAGERS_FAILED",
        message: "Failed to list eligible managers",
        requestId,
      }),
    );
  }
};
