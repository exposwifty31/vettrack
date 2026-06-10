import { Router } from "express";
import { randomUUID } from "crypto";
import { db, auditLogs, users } from "../db.js";
import { desc, eq, and, gte, lte, ilike, sql, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();


const PAGE_SIZE = 50;

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { actionType, performedBy, from, to, page } = req.query as Record<string, string | undefined>;

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const offset = (pageNum - 1) * PAGE_SIZE;

    const conditions = [eq(auditLogs.clinicId, clinicId)];

    if (actionType) {
      conditions.push(eq(auditLogs.actionType, actionType));
    }

    // Case-insensitive partial name match — "sig" matches "Sigal", "dana" matches "Dana"
    if (performedBy && performedBy.trim()) {
      if (performedBy.length > 100) {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "PERFORMED_BY_TOO_LONG", message: "performedBy must be 100 characters or fewer", requestId }));
      }
      conditions.push(ilike(auditLogs.performedBy, `%${performedBy.trim()}%`));
    }

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(gte(auditLogs.timestamp, fromDate));
      }
    }

    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(auditLogs.timestamp, toDate));
      }
    }

    const baseQuery = db
      .select({
        id: auditLogs.id,
        clinicId: auditLogs.clinicId,
        actionType: auditLogs.actionType,
        performedBy: auditLogs.performedBy,
        performedByEmail: auditLogs.performedByEmail,
        performedByName: sql<string | null>`NULLIF(TRIM(COALESCE(${users.displayName}, ${users.name})), '')`,
        targetId: auditLogs.targetId,
        targetType: auditLogs.targetType,
        metadata: auditLogs.metadata,
        timestamp: auditLogs.timestamp,
      })
      .from(auditLogs)
      .leftJoin(
        users,
        and(eq(auditLogs.performedBy, users.id), eq(users.clinicId, clinicId), isNull(users.deletedAt)),
      )
      .orderBy(desc(auditLogs.timestamp))
      .limit(PAGE_SIZE + 1)
      .offset(offset);

    const rows = conditions.length > 0 ? await baseQuery.where(and(...conditions)) : await baseQuery;

    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);

    res.json({
      items,
      hasMore,
      page: pageNum,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "AUDIT_LOGS_FETCH_FAILED",
        message: "Failed to fetch audit logs",
        requestId,
      }),
    );
  }
});

export default router;
