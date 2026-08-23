import type { RequestHandler } from "express";
import { pool } from "../../../db.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

/**
 * GET /api/code-blue/reconciliation
 * Lists ended Code Blue sessions with dispense + billing summary. Admin only.
 */
export const getReconciliationHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const rows = await pool.query(
      `SELECT
         s.id,
         s.started_at        AS "startedAt",
         s.ended_at          AS "endedAt",
         s.outcome,
         s.is_reconciled     AS "isReconciled",
         s.reconciled_at     AS "reconciledAt",
         COUNT(il.id)::int   AS "dispenseCount",
         0::int              AS "billedCount",
         0::int              AS "totalBilledCents"
       FROM vt_code_blue_sessions s
       LEFT JOIN vt_inventory_logs il
         ON il.clinic_id = s.clinic_id
         AND il.quantity_added < 0
         AND il.created_at >= s.started_at
         AND il.created_at <= COALESCE(s.ended_at, NOW())
       WHERE s.clinic_id = $1
         AND s.status = 'ended'
       GROUP BY s.id, s.started_at, s.ended_at, s.outcome,
                s.is_reconciled, s.reconciled_at
       ORDER BY s.started_at DESC
       LIMIT 100`,
      [clinicId],
    );
    res.json(rows.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "RECONCILIATION_LIST_FAILED", message: "Failed to load reconciliation list", requestId }),
    );
  }
};
