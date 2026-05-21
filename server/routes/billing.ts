import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { billingLedger, db, pool, inventoryJobs } from "../db.js";
import { requireAuth, requireAdmin, requireEffectiveRole } from "../middleware/auth.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { enqueueBillingWebhookJob } from "../lib/queue.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { invalidateAnalyticsCache } from "../lib/analytics-cache.js";

/** Invalidate both billing-specific and general analytics caches for a clinic. */
function invalidateBillingCaches(clinicId: string): void {
  invalidateAnalyticsCache(`billing:${clinicId}`);
  invalidateAnalyticsCache(clinicId);
}

const router = Router();

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incoming: unknown,
): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
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

type LeakageReportItem = {
  containerId: string;
  containerName: string;
  unitPriceCents: number;
  dispensedQty: number;
  billedQty: number;
  gapQty: number;
  gapValueCents: number;
  leakagePct: number;
  shift: "day" | "night";
  userId: string | null;
  reason: "scan without billing";
  severity: "HIGH" | "MEDIUM";
};

/** Equipment-scan leakage: checkout scan with no billing ledger entry in the subsequent 24 hours. */
type EquipmentLeakageItem = {
  clinicId: string;
  scanLogId: string;
  equipmentId: string;
  equipmentName: string | null;
  userId: string;
  timestamp: string;
  shift: "day" | "night";
  estimatedPriceCents: number;
  reason: "scan_without_billing";
  severity: "HIGH" | "MEDIUM";
};

async function buildLeakageReport(
  clinicId: string,
  fromDate: Date,
  toDate: Date,
  severityThresholdCents: number,
): Promise<{
  items: LeakageReportItem[];
  summary: {
    totalDispensedQty: number;
    totalBilledQty: number;
    totalGapQty: number;
    totalGapValueCents: number;
    overallLeakagePct: number;
  };
}> {
  const dispenseResult = await pool.query<{
    container_id: string;
    container_name: string;
    billing_item_id: string | null;
    unit_price_cents: number;
    dispensed_qty: number;
    created_hour: number;
    user_id: string | null;
  }>(
    `SELECT
       c.id                              AS container_id,
       c.name                            AS container_name,
       bi.id                             AS billing_item_id,
       COALESCE(bi.unit_price_cents, 0)  AS unit_price_cents,
       SUM(ABS(il.quantity_added))::int  AS dispensed_qty,
       EXTRACT(HOUR FROM il.created_at)::int AS created_hour,
       il.user_id                        AS user_id
     FROM vt_inventory_logs il
     JOIN vt_containers c ON c.id = il.container_id
     LEFT JOIN vt_billing_items bi
       ON bi.id = c.billing_item_id AND bi.clinic_id = $1
     WHERE il.clinic_id = $1
       AND il.log_type  = 'adjustment'
       AND il.quantity_added < 0
       AND il.created_at >= $2
       AND il.created_at <= $3
     GROUP BY c.id, c.name, bi.id, bi.unit_price_cents, EXTRACT(HOUR FROM il.created_at), il.user_id
     HAVING SUM(ABS(il.quantity_added)) > 0`,
    [clinicId, fromDate, toDate],
  );

  const billedResult = await pool.query<{ item_id: string; billed_qty: number }>(
    `SELECT item_id, SUM(quantity)::int AS billed_qty
     FROM vt_billing_ledger
     WHERE clinic_id  = $1
       AND item_type  = 'CONSUMABLE'
       AND status    != 'voided'
       AND created_at >= $2
       AND created_at <= $3
     GROUP BY item_id`,
    [clinicId, fromDate, toDate],
  );

  const billedMap = new Map<string, number>();
  for (const r of billedResult.rows) billedMap.set(r.item_id, r.billed_qty);

  const items = dispenseResult.rows
    .map((r): LeakageReportItem => {
      const billedQty =
        (r.billing_item_id ? (billedMap.get(r.billing_item_id) ?? 0) : 0) +
        (billedMap.get(r.container_id) ?? 0);
      const gapQty = Math.max(0, r.dispensed_qty - billedQty);
      const gapValueCents = gapQty * r.unit_price_cents;
      const shift: "day" | "night" = r.created_hour >= 7 && r.created_hour < 19 ? "day" : "night";
      const severity: "HIGH" | "MEDIUM" = r.unit_price_cents > severityThresholdCents ? "HIGH" : "MEDIUM";
      return {
        containerId: r.container_id,
        containerName: r.container_name,
        unitPriceCents: r.unit_price_cents,
        dispensedQty: r.dispensed_qty,
        billedQty,
        gapQty,
        gapValueCents,
        leakagePct: r.dispensed_qty > 0 ? Math.round((gapQty / r.dispensed_qty) * 100) : 0,
        shift,
        userId: r.user_id,
        reason: "scan without billing",
        severity,
      };
    })
    .sort((a, b) => b.gapValueCents - a.gapValueCents);

  const totalDispensedQty = items.reduce((s, i) => s + i.dispensedQty, 0);
  const totalBilledQty = items.reduce((s, i) => s + i.billedQty, 0);
  const totalGapQty = items.reduce((s, i) => s + i.gapQty, 0);
  const totalGapValueCents = items.reduce((s, i) => s + i.gapValueCents, 0);
  const overallLeakagePct = totalDispensedQty > 0
    ? Math.round((totalGapQty / totalDispensedQty) * 100)
    : 0;

  return { items, summary: { totalDispensedQty, totalBilledQty, totalGapQty, totalGapValueCents, overallLeakagePct } };
}

/**
 * Equipment scan leakage: finds checkout scan_log events with no corresponding billing_ledger
 * entry for that equipment within 24 hours of the scan (time-proximity anti-join).
 *
 * Direct FK join (billingLedger.scanLogId = scanLogs.id) is the preferred strategy once
 * scanLogId is populated at write time. Until clients pass scanLogId to the /seen endpoint,
 * the time-proximity join is the correct detection method.
 */
async function buildEquipmentScanLeakage(
  clinicId: string,
  fromDate: Date,
  toDate: Date,
  severityThresholdCents: number,
): Promise<EquipmentLeakageItem[]> {
  const result = await pool.query<{
    scan_log_id: string;
    equipment_id: string;
    equipment_name: string | null;
    user_id: string;
    ts: Date;
    estimated_price_cents: number;
  }>(
    `SELECT
       sl.id                                          AS scan_log_id,
       sl.equipment_id,
       e.name                                         AS equipment_name,
       sl.user_id,
       sl.timestamp                                   AS ts,
       COALESCE(bi.unit_price_cents, 0)::int          AS estimated_price_cents
     FROM vt_scan_logs sl
     LEFT JOIN vt_equipment e
       ON e.id = sl.equipment_id AND e.clinic_id = sl.clinic_id
     LEFT JOIN vt_billing_items bi
       ON bi.id = e.billing_item_id AND bi.clinic_id = sl.clinic_id
     LEFT JOIN vt_billing_ledger bl
       ON  bl.clinic_id  = sl.clinic_id
       AND bl.item_type  = 'EQUIPMENT'
       AND bl.item_id    = sl.equipment_id
       AND bl.status    != 'voided'
       AND bl.created_at >= sl.timestamp
       AND bl.created_at <= sl.timestamp + INTERVAL '24 hours'
     WHERE sl.clinic_id     = $1
       AND sl.timestamp    >= $2
       AND sl.timestamp    <= $3
       AND sl.equipment_id IS NOT NULL
       AND sl.status       NOT IN ('blocked', 'issue')
       AND bl.id           IS NULL
     ORDER BY sl.timestamp DESC`,
    [clinicId, fromDate, toDate],
  );

  return result.rows.map((r): EquipmentLeakageItem => {
    const hour = new Date(r.ts).getUTCHours();
    const shift: "day" | "night" = hour >= 7 && hour < 19 ? "day" : "night";
    const severity: "HIGH" | "MEDIUM" = r.estimated_price_cents > severityThresholdCents ? "HIGH" : "MEDIUM";
    return {
      clinicId,
      scanLogId: r.scan_log_id,
      equipmentId: r.equipment_id,
      equipmentName: r.equipment_name,
      userId: r.user_id,
      timestamp: new Date(r.ts).toISOString(),
      shift,
      estimatedPriceCents: r.estimated_price_cents,
      reason: "scan_without_billing",
      severity,
    };
  });
}

export const createChargeSchema = z.object({
  animalId: z.string().min(1).optional(),
  itemType: z.enum(["EQUIPMENT", "CONSUMABLE"]),
  itemId: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
  note: z.string().max(500).optional(),
  /** Optional: Idempotency-Key header value used to build deterministic key. */
  idempotencyKeyHint: z.string().max(200).optional(),
}).strict();

export const reverseChargeSchema = z.object({
  reversalReason: z.string().min(1).max(500),
}).strict();

export const leakageOnePagerSchema = z.object({
  summary: z.object({
    totalGapValueCents: z.number().int().nonnegative(),
    totalGapQty: z.number().int().nonnegative(),
    totalDispensedQty: z.number().int().nonnegative().optional(),
    totalBilledQty: z.number().int().nonnegative().optional(),
    overallLeakagePct: z.number().min(0).max(100).optional(),
  }),
  eventsCount: z.number().int().nonnegative().optional(),
  periodDays: z.number().int().min(1).max(365).optional(),
  shift: z.string().min(1).max(120).optional(),
  primaryEquipment: z.string().min(1).max(200).optional(),
  topContributor: z.string().min(1).max(200).optional(),
}).strict();

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// GET /api/billing — list ledger entries for the clinic
router.get("/", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { animalId, status, from, to, limit = "100", offset = "0" } = req.query as Record<string, string>;

    const conditions = [eq(billingLedger.clinicId, clinicId)];
    if (animalId) conditions.push(eq(billingLedger.animalId, animalId));
    if (status) conditions.push(eq(billingLedger.status, status as "pending" | "synced" | "voided"));
    if (from) conditions.push(gte(billingLedger.createdAt, new Date(from)));
    if (to) conditions.push(lte(billingLedger.createdAt, new Date(to)));

    const rows = await db
      .select()
      .from(billingLedger)
      .where(and(...conditions))
      .orderBy(desc(billingLedger.createdAt))
      .limit(Math.min(Number(limit) || 100, 500))
      .offset(Number(offset) || 0);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "BILLING_LIST_FAILED",
        message: "Failed to list billing entries",
        requestId,
      }),
    );
  }
});

// GET /api/billing/summary — aggregate summary for the billing dashboard
router.get("/summary", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { from, to } = req.query as Record<string, string>;

    const dateConditions = [eq(billingLedger.clinicId, clinicId)];
    if (from) dateConditions.push(gte(billingLedger.createdAt, new Date(from)));
    if (to) dateConditions.push(lte(billingLedger.createdAt, new Date(to)));

    const rows = await db
      .select()
      .from(billingLedger)
      .where(and(...dateConditions));

    const nonVoided = rows.filter((r) => r.status !== "voided");
    const pending = rows.filter((r) => r.status === "pending");
    const synced = rows.filter((r) => r.status === "synced");
    const voided = rows.filter((r) => r.status === "voided");

    const totalCents = nonVoided.reduce((s, r) => s + r.totalAmountCents, 0);
    const pendingCents = pending.reduce((s, r) => s + r.totalAmountCents, 0);
    const syncedCents = synced.reduce((s, r) => s + r.totalAmountCents, 0);
    const voidedCents = voided.reduce((s, r) => s + r.totalAmountCents, 0);

    const byType = {
      EQUIPMENT: nonVoided.filter((r) => r.itemType === "EQUIPMENT").reduce((s, r) => s + r.totalAmountCents, 0),
      CONSUMABLE: nonVoided.filter((r) => r.itemType === "CONSUMABLE").reduce((s, r) => s + r.totalAmountCents, 0),
    };

    // Build last-30-days by-day breakdown
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dayMap = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, 0);
    }
    for (const r of nonVoided) {
      const key = new Date(r.createdAt).toISOString().slice(0, 10);
      if (dayMap.has(key)) {
        dayMap.set(key, (dayMap.get(key) ?? 0) + r.totalAmountCents);
      }
    }
    const byDay = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, totalCents]) => ({ date, totalCents }));

    res.json({ totalCents, pendingCents, syncedCents, voidedCents, byType, byDay });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "BILLING_SUMMARY_FAILED",
        message: "Failed to compute billing summary",
        requestId,
      }),
    );
  }
});

// GET /api/billing/leakage-report — dispense vs. billing gap analysis
router.get("/leakage-report", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { from: fromParam, to: toParam } = req.query as Record<string, string>;
    const fromDate = fromParam ? new Date(fromParam) : thirtyDaysAgo;
    const toDate = toParam ? new Date(toParam) : now;

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "INVALID_DATE_RANGE",
          message: "Invalid from or to date",
          requestId,
        }),
      );
    }

    const thresholdParam = Number((req.query as Record<string, string>).thresholdCents ?? "5000");
    const severityThresholdCents = Number.isFinite(thresholdParam) && thresholdParam >= 0 ? Math.floor(thresholdParam) : 5000;
    const [{ items, summary }, equipmentItems] = await Promise.all([
      buildLeakageReport(clinicId, fromDate, toDate, severityThresholdCents),
      buildEquipmentScanLeakage(clinicId, fromDate, toDate, severityThresholdCents),
    ]);

    const totalEquipmentLossCents = equipmentItems.reduce((s, i) => s + i.estimatedPriceCents, 0);

    res.json({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      summary: {
        ...summary,
        totalEquipmentUnbilledEvents: equipmentItems.length,
        totalEquipmentLossCents,
      },
      items,
      equipmentItems,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "LEAKAGE_REPORT_FAILED",
        message: "Failed to compute leakage report",
        requestId,
      }),
    );
  }
});

// POST /api/billing/leakage-report/one-pager — human-readable manager summary from leakage summary data
router.post(
  "/leakage-report/one-pager",
  requireAuth,
  requireEffectiveRole("vet"),
  validateBody(leakageOnePagerSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const payload = leakageOnePagerSchema.parse(req.body);
      const periodDays = payload.periodDays ?? 7;
      const eventsCount = payload.eventsCount ?? payload.summary.totalGapQty;
      const shift = payload.shift ?? "mixed shifts";
      const primaryEquipment = payload.primaryEquipment ?? "general consumables";
      const topContributor = payload.topContributor ?? primaryEquipment;
      const totalMissed = formatUsdFromCents(payload.summary.totalGapValueCents);

      const text = `In the last ${periodDays} days, your clinic missed approximately ${totalMissed} in billable activity across ${eventsCount} events. Most leakage occurred during ${shift}, primarily from ${primaryEquipment}. Top contributor: ${topContributor}.`;

      res.json({
        periodDays,
        text,
        meta: {
          totalGapValueCents: payload.summary.totalGapValueCents,
          totalGapQty: payload.summary.totalGapQty,
          overallLeakagePct: payload.summary.overallLeakagePct ?? null,
          totalDispensedQty: payload.summary.totalDispensedQty ?? null,
          totalBilledQty: payload.summary.totalBilledQty ?? null,
          eventsCount,
          shift,
          primaryEquipment,
          topContributor,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "LEAKAGE_ONE_PAGER_FAILED",
          message: "Failed to generate leakage one-pager summary",
          requestId,
        }),
      );
    }
  },
);

router.get("/leakage-summary", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { from: fromParam, to: toParam } = req.query as Record<string, string>;
    const fromDate = fromParam ? new Date(fromParam) : thirtyDaysAgo;
    const toDate = toParam ? new Date(toParam) : now;
    const thresholdParam = Number((req.query as Record<string, string>).thresholdCents ?? "5000");
    const severityThresholdCents = Number.isFinite(thresholdParam) && thresholdParam >= 0 ? Math.floor(thresholdParam) : 5000;
    const [{ items, summary }, equipmentItems] = await Promise.all([
      buildLeakageReport(clinicId, fromDate, toDate, severityThresholdCents),
      buildEquipmentScanLeakage(clinicId, fromDate, toDate, severityThresholdCents),
    ]);
    const days = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)));
    const top3 = items.slice(0, 3).map((i) => ({ containerId: i.containerId, containerName: i.containerName, gapValueCents: i.gapValueCents }));
    const totalEquipmentLossCents = equipmentItems.reduce((s, i) => s + i.estimatedPriceCents, 0);
    const totalUnbilledEvents = summary.totalGapQty + equipmentItems.length;
    const totalEstimatedLoss = summary.totalGapValueCents + totalEquipmentLossCents;
    return res.json({
      total_unbilled_events: totalUnbilledEvents,
      total_estimated_loss: totalEstimatedLoss,
      avg_loss_per_day: Math.round(totalEstimatedLoss / days),
      top_3_equipment_by_loss: top3,
      equipment_scan_unbilled_events: equipmentItems.length,
      equipment_scan_estimated_loss: totalEquipmentLossCents,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "LEAKAGE_SUMMARY_FAILED", message: "Failed to compute leakage summary", requestId }));
  }
});

router.get("/leakage-report.csv", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const { from: fromParam, to: toParam } = req.query as Record<string, string>;
    const fromDate = fromParam ? new Date(fromParam) : thirtyDaysAgo;
    const toDate = toParam ? new Date(toParam) : now;
    const thresholdParam = Number((req.query as Record<string, string>).thresholdCents ?? "5000");
    const severityThresholdCents = Number.isFinite(thresholdParam) && thresholdParam >= 0 ? Math.floor(thresholdParam) : 5000;
    const [{ items }, equipmentItems] = await Promise.all([
      buildLeakageReport(clinicId, fromDate, toDate, severityThresholdCents),
      buildEquipmentScanLeakage(clinicId, fromDate, toDate, severityThresholdCents),
    ]);
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["type", "event_id", "equipment_id", "equipment_name", "container_id", "container_name", "user_id", "shift", "timestamp", "dispensed_qty", "billed_qty", "gap_qty", "gap_value_cents", "estimated_price_cents", "reason", "severity"].map(escape).join(",");
    const consumableRows = items.map((r) =>
      ["consumable", "", "", "", r.containerId, r.containerName, r.userId ?? "", r.shift, "", String(r.dispensedQty), String(r.billedQty), String(r.gapQty), String(r.gapValueCents), String(r.unitPriceCents), r.reason, r.severity].map(escape).join(","),
    );
    const equipmentRows = equipmentItems.map((r) =>
      ["equipment_scan", r.scanLogId, r.equipmentId, r.equipmentName ?? "", "", "", r.userId, r.shift, r.timestamp, "1", "0", "1", String(r.estimatedPriceCents), String(r.estimatedPriceCents), r.reason, r.severity].map(escape).join(","),
    );
    const csv = [header, ...consumableRows, ...equipmentRows].join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="leakage-report.csv"');
    return res.send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "LEAKAGE_REPORT_EXPORT_FAILED", message: "Failed to export leakage report CSV", requestId }));
  }
});

// GET /api/billing/shift-total — total billing captured since current open shift started
router.get("/shift-total", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;

    // Find the open shift session
    const shiftResult = await pool.query(
      "SELECT started_at FROM vt_shift_sessions WHERE clinic_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
      [clinicId],
    );

    if (shiftResult.rows.length === 0) {
      return res.json({ totalCents: 0, count: 0, shiftActive: false });
    }

    const startedAt: Date = shiftResult.rows[0].started_at;

    // Count billing entries since shift start
    const billingResult = await pool.query(
      "SELECT COUNT(*) AS count, COALESCE(SUM(total_amount_cents), 0) AS total FROM vt_billing_ledger WHERE clinic_id = $1 AND created_at >= $2",
      [clinicId, startedAt],
    );

    const count = parseInt(billingResult.rows[0].count, 10);
    const totalCents = parseInt(billingResult.rows[0].total, 10);

    res.json({ totalCents, count, shiftActive: true });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "SHIFT_TOTAL_FAILED",
        message: "Failed to compute shift billing total",
        requestId,
      }),
    );
  }
});



// GET /api/billing/export.csv — export pending billing entries as CSV
// MUST be registered before /:id or Express will swallow it as id="export.csv"
router.get("/export.csv", requireAuth, requireEffectiveRole("vet"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const result = await pool.query(
      `SELECT bl.id, bl.created_at, bl.item_id, bl.quantity, bl.unit_price_cents, bl.total_amount_cents,
              a.name AS animal_name
       FROM vt_billing_ledger bl
       LEFT JOIN vt_animals a ON a.id = bl.animal_id
       WHERE bl.clinic_id = $1 AND bl.status = 'pending'
       ORDER BY bl.created_at ASC`,
      [clinicId],
    );

    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["date", "patient", "item", "qty", "price", "total"].map(escape).join(",");
    const rows = result.rows.map((r) => {
      const date = new Date(r.created_at).toISOString().slice(0, 10);
      const patient = r.animal_name ?? "Unlinked";
      const price = (r.unit_price_cents / 100).toFixed(2);
      const total = (r.total_amount_cents / 100).toFixed(2);
      return [date, patient, r.item_id, String(r.quantity), price, total].map(escape).join(",");
    });
    const csv = [header, ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="billing-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "BILLING_EXPORT_FAILED", message: "Failed to export billing CSV", requestId }));
  }
});

// GET /api/billing/:id — fetch single entry
router.get("/:id", requireAuth, requireEffectiveRole("vet"), validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [row] = await db
      .select()
      .from(billingLedger)
      .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.id, req.params.id)))
      .limit(1);

    if (!row) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ENTRY_NOT_FOUND", message: "Billing entry not found", requestId }));
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "BILLING_GET_FAILED", message: "Failed to get billing entry", requestId }));
  }
});

// POST /api/billing — create a manual charge (animalId optional for unlinked captures)
router.post(
  "/",
  requireAuth,
  requireEffectiveRole("vet"),
  idempotencyMiddleware("billing:create"),
  validateBody(createChargeSchema),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const b = req.body as z.infer<typeof createChargeSchema>;
    const id = randomUUID();
    const totalAmountCents = b.quantity * b.unitPriceCents;

    // Fix C: deterministic idempotency key.
    // Use Idempotency-Key header if provided; otherwise derive from content to
    // ensure replayed requests don't create duplicates within a 5-minute window.
    const headerKey = typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"].trim()
      : null;
    const roundedMinute = Math.floor(Date.now() / (5 * 60 * 1000));
    const idempotencyKey = headerKey
      ? `manual:header:${headerKey}`
      : `manual:${clinicId}:${b.itemId}:${totalAmountCents}:${roundedMinute}`;

    await db.insert(billingLedger).values({
      id,
      clinicId,
      animalId: b.animalId ?? null,
      itemType: b.itemType,
      itemId: b.itemId,
      quantity: b.quantity,
      unitPriceCents: b.unitPriceCents,
      totalAmountCents,
      idempotencyKey,
      status: "pending",
      entryType: "CHARGE",
      sourceType: "MANUAL",
      createdBy: req.authUser!.id,
    }).onConflictDoNothing();

    const [row] = await db.select().from(billingLedger).where(eq(billingLedger.id, id)).limit(1);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "billing_charge_created",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "billing_entry",
      metadata: { itemType: b.itemType, itemId: b.itemId, quantity: b.quantity, totalAmountCents, animalId: b.animalId ?? null, sourceType: "MANUAL" },
    });

    invalidateBillingCaches(clinicId);

    // Fire webhook if configured (config lookup handled inside enqueueBillingWebhookJob)
    try {
      await enqueueBillingWebhookJob({
        clinicId,
        entry: {
          id: row.id,
          animalId: row.animalId,
          itemType: row.itemType,
          itemId: row.itemId,
          quantity: row.quantity,
          unitPriceCents: row.unitPriceCents,
          totalAmountCents: row.totalAmountCents,
          status: row.status,
          createdAt: row.createdAt,
        },
      });
    } catch (webhookErr) {
      console.error("[billing-webhook] Failed to enqueue webhook for manual charge, continuing:", webhookErr);
    }

    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "BILLING_CREATE_FAILED", message: "Failed to create billing entry", requestId }));
  }
});

/**
 * POST /api/billing/:id/reverse — append-only correction (Fix A).
 * Creates a new REVERSAL entry with totalAmountCents = -original.
 * The original CHARGE row is NEVER modified.
 * Cannot reverse a REVERSAL (prevents double reversals).
 */
router.post(
  "/:id/reverse",
  requireAuth,
  requireAdmin,
  idempotencyMiddleware("billing:reverse"),
  validateUuid("id"),
  validateBody(reverseChargeSchema),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { reversalReason } = req.body as z.infer<typeof reverseChargeSchema>;

    const [original] = await db
      .select()
      .from(billingLedger)
      .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.id, req.params.id)))
      .limit(1);

    if (!original) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ENTRY_NOT_FOUND", message: "Billing entry not found", requestId }));

    if (original.entryType === "REVERSAL") {
      return res.status(409).json(apiError({ code: "CONFLICT", reason: "CANNOT_REVERSE_REVERSAL", message: "A REVERSAL entry cannot itself be reversed", requestId }));
    }

    // Check if a reversal already exists for this charge (idempotent guard)
    const existingReversal = await db
      .select({ id: billingLedger.id })
      .from(billingLedger)
      .where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.reversesId, original.id)))
      .limit(1);
    if (existingReversal.length > 0) {
      return res.status(409).json(apiError({ code: "CONFLICT", reason: "ALREADY_REVERSED", message: "A reversal already exists for this charge", requestId }));
    }

    const reversalId = randomUUID();
    const reversalIdempotencyKey = `reversal:${original.id}`;

    const [reversal] = await db.insert(billingLedger).values({
      id: reversalId,
      clinicId,
      animalId: original.animalId,
      itemType: original.itemType,
      itemId: original.itemId,
      quantity: -original.quantity,
      unitPriceCents: original.unitPriceCents,
      totalAmountCents: -original.totalAmountCents,
      idempotencyKey: reversalIdempotencyKey,
      status: "pending",
      entryType: "REVERSAL",
      reversesId: original.id,
      reversalReason,
      sourceType: original.sourceType,
      taskId: original.taskId,
      dispenseEventId: original.dispenseEventId,
      createdBy: req.authUser!.id,
      formularyId: original.formularyId,
      formularyVersion: original.formularyVersion,
    }).onConflictDoNothing().returning();

    if (!reversal) {
      // Idempotent replay — return existing reversal
      const [existingRev] = await db.select().from(billingLedger).where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.idempotencyKey, reversalIdempotencyKey))).limit(1);
      if (existingRev) return res.json(existingRev);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "REVERSAL_FAILED", message: "Failed to create reversal entry", requestId }));
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "billing_reversed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: reversalId,
      targetType: "billing_entry",
      metadata: {
        originalId: original.id,
        originalAmount: original.totalAmountCents,
        reversalAmount: -original.totalAmountCents,
        reversalReason,
        itemType: original.itemType,
        itemId: original.itemId,
      },
    });

    invalidateBillingCaches(clinicId);

    return res.status(201).json(reversal);
  } catch (err) {
    console.error(err);
    return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "BILLING_REVERSE_FAILED", message: "Failed to create reversal", requestId }));
  }
});

/**
 * PATCH /api/billing/:id/void — deprecated alias for reverse.
 * Kept for backward compatibility; delegates to the reverse logic.
 * @deprecated Use POST /:id/reverse instead.
 */
router.patch(
  "/:id/void",
  requireAuth,
  requireAdmin,
  idempotencyMiddleware("billing:void"),
  validateUuid("id"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const [original] = await db.select().from(billingLedger).where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.id, req.params.id))).limit(1);
    if (!original) return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "ENTRY_NOT_FOUND", message: "Billing entry not found", requestId }));
    if (original.entryType === "REVERSAL") return res.status(409).json(apiError({ code: "CONFLICT", reason: "CANNOT_REVERSE_REVERSAL", message: "Cannot void a REVERSAL entry", requestId }));

    const existingReversal = await db.select({ id: billingLedger.id }).from(billingLedger).where(and(eq(billingLedger.clinicId, clinicId), eq(billingLedger.reversesId, original.id))).limit(1);
    if (existingReversal.length > 0) return res.status(409).json(apiError({ code: "CONFLICT", reason: "ALREADY_VOIDED", message: "Billing entry is already voided", requestId }));

    const reversalId = randomUUID();
    const [reversal] = await db.insert(billingLedger).values({
      id: reversalId,
      clinicId,
      animalId: original.animalId,
      itemType: original.itemType,
      itemId: original.itemId,
      quantity: -original.quantity,
      unitPriceCents: original.unitPriceCents,
      totalAmountCents: -original.totalAmountCents,
      idempotencyKey: `reversal:${original.id}`,
      status: "pending",
      entryType: "REVERSAL",
      reversesId: original.id,
      reversalReason: "voided via legacy endpoint",
      sourceType: original.sourceType,
      taskId: original.taskId,
      dispenseEventId: original.dispenseEventId,
      createdBy: req.authUser!.id,
    }).onConflictDoNothing().returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "billing_voided",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "billing_ledger",
      metadata: { originalId: original.id, reversalId: reversal?.id ?? null, totalAmountCents: original.totalAmountCents, via: "void_endpoint" },
    });

    invalidateBillingCaches(clinicId);
    return res.json(reversal ?? { message: "Reversal already exists" });
  } catch (err) {
    console.error(err);
    return res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "BILLING_VOID_FAILED", message: "Failed to void billing entry", requestId }));
  }
});

export const bulkSyncSchema = z.object({
  ids: z.array(z.string()).min(1),
}).strict();

// PATCH /api/billing/bulk-sync — mark billing entries as synced
router.patch(
  "/bulk-sync",
  requireAuth,
  requireAdmin,
  idempotencyMiddleware("billing:bulk-sync"),
  validateBody(bulkSyncSchema),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { ids } = req.body as z.infer<typeof bulkSyncSchema>;
    const result = await pool.query(
      "UPDATE vt_billing_ledger SET status = 'synced' WHERE id = ANY($1) AND clinic_id = $2",
      [ids, clinicId],
    );

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "billing_bulk_synced",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetType: "billing_ledger",
      metadata: { ids, updatedCount: result.rowCount ?? 0 },
    });

    invalidateBillingCaches(clinicId);
    res.json({ updated: result.rowCount ?? 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "BILLING_BULK_SYNC_FAILED", message: "Failed to bulk sync billing entries", requestId }));
  }
});

// GET /api/billing/inventory-jobs — list pending/processing/failed inventory deduction jobs (admin only)
router.get("/inventory-jobs", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status } = req.query as Record<string, string>;
    const validStatuses = ["pending", "processing", "resolved", "failed"] as const;
    const statusFilter =
      status && validStatuses.includes(status as (typeof validStatuses)[number])
        ? [status as (typeof validStatuses)[number]]
        : ["pending", "processing", "failed"];

    const jobs = await db
      .select()
      .from(inventoryJobs)
      .where(and(eq(inventoryJobs.clinicId, clinicId), inArray(inventoryJobs.status, statusFilter)))
      .orderBy(desc(inventoryJobs.createdAt))
      .limit(200);

    return res.json(
      jobs.map((j) => ({
        id: j.id,
        clinicId: j.clinicId,
        taskId: j.taskId,
        containerId: j.containerId,
        requiredVolumeMl: j.requiredVolumeMl,
        animalId: j.animalId,
        status: j.status,
        retryCount: j.retryCount,
        failureReason: j.failureReason,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
        resolvedAt: j.resolvedAt?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    console.error("[billing] inventory-jobs list error", err);
    return res
      .status(500)
      .json(apiError({ code: "INTERNAL_ERROR", reason: "INTERNAL_ERROR", message: "Internal error", requestId }));
  }
});

// POST /api/billing/inventory-jobs/:id/retry — reset a failed job to pending (admin only)
router.post(
  "/inventory-jobs/:id/retry",
  requireAuth,
  requireAdmin,
  idempotencyMiddleware("billing:inventory-job-retry"),
  async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const { id } = req.params;
  const clinicId = req.clinicId!;
  try {
    const [existing] = await db
      .select()
      .from(inventoryJobs)
      .where(and(eq(inventoryJobs.id, id), eq(inventoryJobs.clinicId, clinicId)))
      .limit(1);

    if (!existing) {
      return res
        .status(404)
        .json(apiError({ code: "NOT_FOUND", reason: "NOT_FOUND", message: "Job not found", requestId }));
    }

    if (existing.status !== "failed") {
      return res
        .status(409)
        .json(apiError({ code: "CONFLICT", reason: "NOT_FAILED", message: "Only failed jobs can be retried", requestId }));
    }

    await db
      .update(inventoryJobs)
      .set({ status: "pending", failureReason: null, updatedAt: new Date() })
      .where(and(eq(inventoryJobs.id, id), eq(inventoryJobs.clinicId, clinicId)));

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[billing] inventory-jobs retry error", err);
    return res
      .status(500)
      .json(apiError({ code: "INTERNAL_ERROR", reason: "INTERNAL_ERROR", message: "Internal error", requestId }));
  }
});

export default router;
