import { Router } from "express";
import { randomUUID } from "crypto";
import { db, pool, equipment, scanLogs } from "../db.js";
import { gte, desc, eq, and, isNull, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { subDays } from "date-fns";
import { analyticsCache } from "../lib/analytics-cache.js";
import { computeUsageTrends } from "../lib/analytics-engine.js";
import { INACTIVE_THRESHOLD_DAYS } from "../../shared/constants.js";
import { getOutcomeKpiRoiDashboard } from "../services/outcome-kpi-roi.service.js";

/*
 * PERMISSIONS MATRIX — /api/analytics
 * ─────────────────────────────────────────────────────
 * GET  /         student+  Aggregate dashboard statistics
 * GET  /billing  student+  Billing analytics dashboard
 * GET  /outcome-kpi-roi  student+  Outcome KPI & ROI vs pre-activation baseline (requires config)
 * ─────────────────────────────────────────────────────
 * Viewer read access is intentional — dashboard stats are informational
 * and do not expose any PII or mutation capability.
 */

const router = Router();

function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const cached = analyticsCache.get(clinicId);
    if (cached) {
      res.setHeader("X-Analytics-Cache", "HIT");
      return res.json(cached);
    }

    const allEquipment = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)));
    const total = allEquipment.length;

    const statusBreakdown = {
      ok: 0,
      issue: 0,
      maintenance: 0,
      sterilized: 0,
      overdue: 0,
      inactive: 0,
    };

    const now = new Date();
    const inactiveCutoff = subDays(now, INACTIVE_THRESHOLD_DAYS);
    const sevenDaysAgo = subDays(now, 7);

    for (const item of allEquipment) {
      const status = (item.status || "ok") as string;
      if (status in statusBreakdown) {
        statusBreakdown[status as keyof typeof statusBreakdown]++;
      }

      if (item.maintenanceIntervalDays && item.lastMaintenanceDate) {
        const dueDate = new Date(item.lastMaintenanceDate);
        dueDate.setDate(dueDate.getDate() + item.maintenanceIntervalDays);
        if (now > dueDate) statusBreakdown.overdue++;
      }

      if (!item.lastSeen || new Date(item.lastSeen) < inactiveCutoff) {
        statusBreakdown.inactive++;
      }
    }

    const withMaintenance = allEquipment.filter(
      (e) => e.maintenanceIntervalDays && e.maintenanceIntervalDays > 0
    );
    const compliant = withMaintenance.filter((e) => {
      if (!e.lastMaintenanceDate) return false;
      const dueDate = new Date(e.lastMaintenanceDate);
      dueDate.setDate(dueDate.getDate() + e.maintenanceIntervalDays!);
      return now <= dueDate;
    });
    const maintenanceComplianceRate =
      withMaintenance.length > 0
        ? Math.round((compliant.length / withMaintenance.length) * 100)
        : 100;

    const withSterilization = allEquipment.filter((e) => e.lastSterilizationDate);
    const sterilizationCompliant = withSterilization.filter(
      (e) => new Date(e.lastSterilizationDate!) >= sevenDaysAgo
    );
    const sterilizationComplianceRate =
      withSterilization.length > 0
        ? Math.round((sterilizationCompliant.length / withSterilization.length) * 100)
        : 100;

    const thirtyDaysAgo = subDays(now, 29);
    const recentScans = await db
      .select()
      .from(scanLogs)
      .where(and(eq(scanLogs.clinicId, clinicId), gte(scanLogs.timestamp, thirtyDaysAgo)))
      .orderBy(desc(scanLogs.timestamp));

    const scanActivity = computeUsageTrends(recentScans.map((s) => ({ ...s, equipmentId: s.equipmentId ?? undefined })));

    // Single grouped query (JOIN + GROUP BY + LIMIT) avoids N+1 lookups.
    const topProblemEquipment = await db
      .select({
        equipmentId: scanLogs.equipmentId,
        name: sql<string>`COALESCE(${equipment.name}, 'Unknown')`,
        issueCount: sql<number>`count(*)::int`,
      })
      .from(scanLogs)
      .leftJoin(equipment, and(eq(scanLogs.equipmentId, equipment.id), eq(equipment.clinicId, clinicId)))
      .where(
        and(
          eq(scanLogs.clinicId, clinicId),
          gte(scanLogs.timestamp, thirtyDaysAgo),
          eq(scanLogs.status, "issue")
        )
      )
      // Keep deleted equipment in history; no deletedAt filter by design.
      .groupBy(scanLogs.equipmentId, equipment.name)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const payload = {
      totalEquipment: total,
      statusBreakdown,
      maintenanceComplianceRate,
      sterilizationComplianceRate,
      scanActivity,
      topProblemEquipment,
    };

    analyticsCache.set(clinicId, payload);
    res.setHeader("X-Analytics-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ANALYTICS_FETCH_FAILED",
        message: "Failed to get analytics",
        requestId,
      }),
    );
  }
});

// GET /api/analytics/billing — billing analytics for the dashboard
router.get("/billing", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const cacheKey = `billing:${clinicId}`;
    const cached = analyticsCache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Analytics-Cache", "HIT");
      return res.json(cached);
    }

    // rolling30dayTrend: daily totals (non-voided) for last 30 days
    const trendResult = await pool.query(
      `SELECT
         DATE(created_at)::text AS date,
         SUM(total_amount_cents)::int AS "totalCents",
         COUNT(*)::int AS "entryCount"
       FROM vt_billing_ledger
       WHERE clinic_id = $1
         AND status != 'voided'
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at)`,
      [clinicId],
    );
    const rolling30dayTrend: Array<{ date: string; totalCents: number; entryCount: number }> =
      trendResult.rows.map((r) => ({
        date: r.date as string,
        totalCents: Number(r.totalCents),
        entryCount: Number(r.entryCount),
      }));

    // top10ItemsByVolume: join billing_ledger with billing_items for names,
    // compute dispensed (from inventory_logs) vs billed gap
    const top10Result = await pool.query(
      `WITH billed AS (
         SELECT
           bl.item_id,
           bi.description   AS item_name,
           COUNT(*)::int    AS total_billed,
           SUM(bl.quantity) AS total_billed_qty
         FROM vt_billing_ledger bl
         JOIN vt_billing_items bi ON bi.id = bl.item_id
         WHERE bl.clinic_id = $1
           AND bl.status != 'voided'
           AND bl.created_at >= NOW() - INTERVAL '30 days'
         GROUP BY bl.item_id, bi.description
         ORDER BY COUNT(*) DESC
         LIMIT 10
       ),
       dispensed AS (
         SELECT
           c.billing_item_id AS item_id,
           SUM(ABS(il.quantity_added)) AS total_dispensed
         FROM vt_inventory_logs il
         JOIN vt_containers c ON c.id = il.container_id
         LEFT JOIN vt_items vi ON vi.id = (il.metadata->>'itemId')
         WHERE il.clinic_id = $1
           AND il.quantity_added < 0
           AND il.created_at >= NOW() - INTERVAL '30 days'
           AND c.billing_item_id IS NOT NULL
           AND (vi.is_billable IS NULL OR vi.is_billable = true)
         GROUP BY c.billing_item_id
       )
       SELECT
         b.item_id AS "itemId",
         b.item_name AS "itemName",
         COALESCE(d.total_dispensed, 0)::int AS "totalDispensed",
         b.total_billed AS "totalBilled",
         CASE WHEN COALESCE(d.total_dispensed, 0) > 0
              THEN ROUND((COALESCE(d.total_dispensed, 0) - b.total_billed)::numeric
                         / COALESCE(d.total_dispensed, 0) * 100, 1)
              ELSE 0
         END AS "gapRatePercent"
       FROM billed b
       LEFT JOIN dispensed d ON d.item_id = b.item_id
       ORDER BY b.total_billed DESC`,
      [clinicId],
    );
    const top10ItemsByVolume = top10Result.rows.map((r) => ({
      itemId: r.itemId as string,
      itemName: r.itemName as string,
      totalDispensed: Number(r.totalDispensed),
      totalBilled: Number(r.totalBilled),
      gapRatePercent: Number(r.gapRatePercent),
    }));

    // leakageRateTrend: last 12 weeks, gap between dispensed and billed per week
    const leakageResult = await pool.query(
      `WITH weeks AS (
         SELECT generate_series(0, 11) AS week_offset
       ),
       week_starts AS (
         SELECT DATE_TRUNC('week', NOW()) - (week_offset * INTERVAL '1 week') AS week_start
         FROM weeks
       ),
       dispensed AS (
         SELECT
           DATE_TRUNC('week', il.created_at) AS week_start,
           SUM(ABS(il.quantity_added)) AS total_dispensed
         FROM vt_inventory_logs il
         JOIN vt_containers c ON c.id = il.container_id
         WHERE il.clinic_id = $1
           AND il.quantity_added < 0
           AND il.created_at >= NOW() - INTERVAL '12 weeks'
           AND c.billing_item_id IS NOT NULL
         GROUP BY DATE_TRUNC('week', il.created_at)
       ),
       billed AS (
         SELECT
           DATE_TRUNC('week', created_at) AS week_start,
           SUM(quantity) AS total_billed
         FROM vt_billing_ledger
         WHERE clinic_id = $1
           AND item_type = 'CONSUMABLE'
           AND status != 'voided'
           AND created_at >= NOW() - INTERVAL '12 weeks'
         GROUP BY DATE_TRUNC('week', created_at)
       )
       SELECT
         ws.week_start::date::text AS "weekStart",
         CASE WHEN COALESCE(d.total_dispensed, 0) > 0
              THEN ROUND((COALESCE(d.total_dispensed, 0) - COALESCE(b.total_billed, 0))::numeric
                         / COALESCE(d.total_dispensed, 0) * 100, 1)
              ELSE 0
         END AS "gapRatePercent"
       FROM week_starts ws
       LEFT JOIN dispensed d ON d.week_start = ws.week_start
       LEFT JOIN billed b ON b.week_start = ws.week_start
       ORDER BY ws.week_start`,
      [clinicId],
    );
    const leakageRateTrend = leakageResult.rows.map((r) => ({
      weekStart: r.weekStart as string,
      gapRatePercent: Number(r.gapRatePercent),
    }));

    // avgEntriesPerShift: COUNT(billing entries) / COUNT(shift sessions) for last 30 days
    const avgResult = await pool.query(
      `WITH billing_count AS (
         SELECT COUNT(*) AS entry_count
         FROM vt_billing_ledger
         WHERE clinic_id = $1
           AND status != 'voided'
           AND created_at >= NOW() - INTERVAL '30 days'
       ),
       shift_count AS (
         SELECT COUNT(*) AS session_count
         FROM vt_shift_sessions
         WHERE clinic_id = $1
           AND started_at >= NOW() - INTERVAL '30 days'
       )
       SELECT
         bc.entry_count,
         sc.session_count,
         CASE WHEN sc.session_count > 0
              THEN ROUND(bc.entry_count::numeric / sc.session_count, 1)
              ELSE 0
         END AS avg_entries
       FROM billing_count bc, shift_count sc`,
      [clinicId],
    );
    const avgEntriesPerShift =
      avgResult.rows.length > 0 ? Number(avgResult.rows[0].avg_entries) : 0;

    const payload = {
      rolling30dayTrend,
      top10ItemsByVolume,
      leakageRateTrend,
      avgEntriesPerShift,
    };

    analyticsCache.set(cacheKey, payload);
    res.setHeader("X-Analytics-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "BILLING_ANALYTICS_FAILED",
        message: "Failed to get billing analytics",
        requestId,
      }),
    );
  }
});

/** GET /api/analytics/outcome-kpi-roi — Phase 7 leadership dashboard (real DB comparison windows). */
router.get("/outcome-kpi-roi", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const body = await getOutcomeKpiRoiDashboard(clinicId);
    res.setHeader("X-Analytics-Cache", "MISS");
    res.json(body);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "OUTCOME_KPI_ROI_FAILED",
        message: "Failed to compute outcome KPI metrics",
        requestId,
      }),
    );
  }
});

/**
 * GET /api/analytics/shift-completion?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns per-user scan counts and shift stats. Defaults to last 30 days. Admin only.
 */
router.get("/shift-completion", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
    const toRaw   = typeof req.query.to   === "string" ? req.query.to   : null;
    const from = fromRaw ? new Date(fromRaw) : subDays(new Date(), 30);
    const to   = toRaw   ? new Date(toRaw)   : new Date();
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json(
        apiError({ code: "INVALID_PARAMS", reason: "INVALID_DATE_RANGE", message: "Invalid from/to dates", requestId }),
      );
    }
    const rows = await pool.query(
      `WITH user_scans AS (
         SELECT sl.user_id, COUNT(*)::int AS total_scans
         FROM vt_scan_logs sl
         WHERE sl.clinic_id = $1
           AND sl.timestamp >= $2
           AND sl.timestamp < $3
         GROUP BY sl.user_id
       ),
       user_shifts AS (
         SELECT
           ss.started_by_user_id AS user_id,
           COUNT(*)::int AS shift_count,
           COUNT(*) FILTER (
             WHERE NOT EXISTS (
               SELECT 1 FROM vt_scan_logs sl2
               WHERE sl2.user_id = ss.started_by_user_id
                 AND sl2.clinic_id = ss.clinic_id
                 AND sl2.timestamp >= ss.started_at
                 AND sl2.timestamp < COALESCE(ss.ended_at, NOW())
             )
           )::int AS zero_capture_shifts
         FROM vt_shift_sessions ss
         WHERE ss.clinic_id = $1
           AND ss.started_at >= $2
           AND ss.started_at < $3
         GROUP BY ss.started_by_user_id
       )
       SELECT
         u.id                                                         AS "userId",
         u.name,
         u.email,
         COALESCE(us.total_scans, 0)::int                            AS "totalScans",
         COALESCE(ush.shift_count, 0)::int                           AS "shiftCount",
         CASE
           WHEN COALESCE(ush.shift_count, 0) > 0
           THEN ROUND(COALESCE(us.total_scans, 0)::numeric / ush.shift_count, 1)
           ELSE 0
         END                                                          AS "avgScansPerShift",
         COALESCE(ush.zero_capture_shifts, 0)::int                   AS "zeroCaptureShifts"
       FROM vt_users u
       LEFT JOIN user_scans  us  ON us.user_id  = u.id
       LEFT JOIN user_shifts ush ON ush.user_id = u.id
       WHERE u.clinic_id = $1
         AND (COALESCE(us.total_scans, 0) > 0 OR COALESCE(ush.shift_count, 0) > 0)
       ORDER BY COALESCE(us.total_scans, 0) DESC`,
      [clinicId, from.toISOString(), to.toISOString()],
    );
    res.json({ from: from.toISOString(), to: to.toISOString(), users: rows.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SHIFT_COMPLETION_FAILED", message: "Failed to get shift completion stats", requestId }),
    );
  }
});

export default router;
