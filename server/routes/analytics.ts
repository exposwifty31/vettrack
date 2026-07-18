import { Router } from "express";
import { randomUUID } from "crypto";
import { db, pool, equipment, scanLogs, rooms, appointments } from "../db.js";
import { gte, lt, desc, eq, and, isNull, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { subDays } from "date-fns";
import { analyticsCache } from "../lib/analytics-cache.js";
import { computeUsageTrends } from "../lib/analytics-engine.js";
import {
  computeReadiness,
  computeOccupancy,
  computePerRoom,
  computeOnTime,
  type EquipmentKpiRow,
} from "../lib/analytics-kpis.js";
import { INACTIVE_THRESHOLD_DAYS } from "../../shared/constants.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { getReadinessForecast } from "../services/readiness-forecast.service.js";

/*
 * PERMISSIONS MATRIX — /api/analytics
 * ─────────────────────────────────────────────────────
 * GET  /         student+  Aggregate dashboard statistics
 * GET  /billing  student+  Billing analytics dashboard
 * ─────────────────────────────────────────────────────
 * Viewer read access is intentional — dashboard stats are informational
 * and do not expose any PII or mutation capability.
 */

const router = Router();



router.get("/", requireAuth, requireEffectiveRole("student"), async (req, res) => {
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

    // --- Phase 7e additive KPIs (all clinic-scoped, point-in-time, real-data-backed) ---
    const nowMs = now.getTime();
    const readiness = computeReadiness(allEquipment as EquipmentKpiRow[], nowMs);
    const occupancy = computeOccupancy(allEquipment as EquipmentKpiRow[]);

    const roomRows = await db
      .select({ id: rooms.id, name: rooms.name })
      .from(rooms)
      .where(eq(rooms.clinicId, clinicId));
    const roomNameById = new Map(roomRows.map((r) => [r.id, r.name]));
    const perRoom = computePerRoom(allEquipment as EquipmentKpiRow[], roomNameById);

    // Task on-time: completed tasks whose completedAt ≤ endTime, trailing 30d vs prior 30d.
    const onTimeCounts = async (from: Date, to: Date) => {
      const [r] = await db
        .select({
          onTimeCount: sql<number>`count(*) filter (where ${appointments.completedAt} is not null and ${appointments.completedAt} <= ${appointments.endTime})::int`,
          completedCount: sql<number>`count(*) filter (where ${appointments.completedAt} is not null)::int`,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.clinicId, clinicId),
            eq(appointments.status, "completed"),
            gte(appointments.endTime, from),
            lt(appointments.endTime, to),
          ),
        );
      return { onTimeCount: Number(r?.onTimeCount ?? 0), completedCount: Number(r?.completedCount ?? 0) };
    };
    const priorFrom = subDays(now, 60);
    const currentFrom = subDays(now, 30);
    const [currentOnTime, priorOnTime] = await Promise.all([
      onTimeCounts(currentFrom, now),
      onTimeCounts(priorFrom, currentFrom),
    ]);
    const taskOnTime = computeOnTime(currentOnTime, priorOnTime);

    const payload = {
      totalEquipment: total,
      statusBreakdown,
      maintenanceComplianceRate,
      sterilizationComplianceRate,
      scanActivity,
      topProblemEquipment,
      readiness,
      occupancy,
      perRoom,
      taskOnTime,
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

// GET /api/analytics/billing — stub (billing schema removed)
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

    const payload = {
      rolling30dayTrend: [] as Array<{ date: string; totalCents: number; entryCount: number }>,
      top10ItemsByVolume: [] as Array<{
        itemId: string;
        itemName: string;
        totalDispensed: number;
        totalBilled: number;
        gapRatePercent: number;
      }>,
      leakageRateTrend: [] as Array<{ weekStart: string; gapRatePercent: number }>,
      avgEntriesPerShift: 0,
    };

    analyticsCache.set(cacheKey, payload);
    res.setHeader("X-Analytics-Cache", "MISS");
    return res.json(payload);
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
    type ShiftCompletionRow = {
      userId: string;
      name: string;
      email: string;
      totalScans: number;
      shiftCount: number;
      avgScansPerShift: number;
      zeroCaptureShifts: number;
    };
    const rows = await pool.query<ShiftCompletionRow>(
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

/**
 * GET /api/analytics/readiness-forecast — R-PDF-1 predictive readiness.
 * READ-ONLY: returns forecast shortfalls + redacted explainability + PO
 * RECOMMENDATIONS. Creates no purchase orders. Technician+ (procurement-adjacent).
 */
router.get("/readiness-forecast", requireAuth, requireEffectiveRole("technician"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const forecast = await getReadinessForecast(clinicId);
    res.json(forecast);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "READINESS_FORECAST_FAILED",
        message: "Failed to compute readiness forecast",
        requestId,
      }),
    );
  }
});

export default router;
