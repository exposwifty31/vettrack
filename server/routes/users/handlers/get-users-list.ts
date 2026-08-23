import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { ensureUserEmail } from "../../../services/user-sync.service.js";
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

/** Admin list only: includes clerkId for self-healing missing emails from Clerk. */
const adminListUserFields = {
  ...userFields,
  clerkId: users.clerkId,
  secondaryRole: users.secondaryRole,
  isEquipmentCoordinator: users.isEquipmentCoordinator,
  seniorDoctorEligible: users.seniorDoctorEligible,
};

/** GET /api/users */
export const getUsersListHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status } = req.query;
    const validStatuses = ["pending", "active", "blocked"];
    if (status !== undefined && !validStatuses.includes(status as string)) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "INVALID_STATUS_FILTER",
          message: "Invalid status filter. Must be one of: pending, active, blocked",
          requestId,
        }),
      );
    }

    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawPage = parseInt(req.query.page as string, 10);
    const resolvedLimit = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 200) : 100;
    const page = (!isNaN(rawPage) && rawPage > 1) ? rawPage : 1;
    const resolvedOffset = (page - 1) * resolvedLimit;

    const baseQuery = status
      ? db
          .select(adminListUserFields)
          .from(users)
          .where(and(eq(users.clinicId, clinicId), eq(users.status, status as string), isNull(users.deletedAt)))
          .orderBy(desc(users.createdAt))
      : db
          .select(adminListUserFields)
          .from(users)
          .where(and(eq(users.clinicId, clinicId), isNull(users.deletedAt)))
          .orderBy(desc(users.createdAt));

    const whereClause = status
      ? and(eq(users.clinicId, clinicId), eq(users.status, status as string), isNull(users.deletedAt))
      : and(eq(users.clinicId, clinicId), isNull(users.deletedAt));
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);
    const items = await baseQuery.limit(resolvedLimit).offset(resolvedOffset);
    const healedRows = await Promise.all(items.map((u) => ensureUserEmail(u)));
    const healedItems = items.map((item, i) => ({
      id: item.id,
      email: healedRows[i].email,
      name: item.name,
      displayName: item.displayName,
      role: item.role,
      secondaryRole: item.secondaryRole ?? null,
      isEquipmentCoordinator: item.isEquipmentCoordinator ?? false,
      seniorDoctorEligible: item.seniorDoctorEligible ?? false,
      status: item.status,
      createdAt: item.createdAt,
    }));
    res.json({
      items: healedItems,
      total,
      page,
      pageSize: resolvedLimit,
      hasMore: resolvedOffset + healedItems.length < total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_LIST_FAILED",
        message: "Failed to list users",
        requestId,
      }),
    );
  }
};
