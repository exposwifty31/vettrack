import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNotNull, desc } from "drizzle-orm";
import { resolveRequestId, apiError } from "../users-route-utils.js";

const userFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  displayName: users.displayName,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
};

/** GET /api/users/deleted */
export const getUsersDeletedHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const deletedUsers = await db
      .select({ ...userFields, deletedAt: users.deletedAt })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), isNotNull(users.deletedAt)))
      .orderBy(desc(users.deletedAt));
    res.json(deletedUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_LIST_DELETED_FAILED",
        message: "Failed to list deleted users",
        requestId,
      }),
    );
  }
};
