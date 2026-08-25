import type { RequestHandler } from "express";
import { db, pool, codeBlueSessions } from "../../../db.js";
import { eq, and } from "drizzle-orm";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

/**
 * GET /api/code-blue/sessions/:id/dispenses
 * Returns inventory dispenses during a Code Blue session with billing status. Admin only.
 */
export const getSessionsIdDispensesHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const sessionId = req.params.id;
    const [session] = await db
      .select({ startedAt: codeBlueSessions.startedAt, endedAt: codeBlueSessions.endedAt })
      .from(codeBlueSessions)
      .where(and(eq(codeBlueSessions.id, sessionId), eq(codeBlueSessions.clinicId, clinicId)))
      .limit(1);
    if (!session) {
      return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SESSION_NOT_FOUND", message: "Session not found", requestId }));
    }
    const rows = await pool.query(
      `SELECT
         il.id,
         il.quantity_added       AS "quantityAdded",
         il.created_at           AS "createdAt",
         c.name                  AS "containerName",
         NULL::text             AS "billingId",
         NULL::int              AS "totalAmountCents",
         NULL::text             AS "billingStatus"
       FROM vt_inventory_logs il
       JOIN vt_containers c
         ON c.id = il.container_id
         AND c.clinic_id = il.clinic_id
       WHERE il.clinic_id = $1
         AND il.quantity_added < 0
         AND il.created_at >= $2
         AND il.created_at <= $3
       ORDER BY il.created_at`,
      [clinicId, session.startedAt.toISOString(), (session.endedAt ?? new Date()).toISOString()],
    );
    res.json(rows.rows);
  } catch (err) {
    console.error("[code-blue] session dispenses failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_DISPENSES_FAILED", message: "Failed to load session dispenses", requestId }),
    );
  }
};
