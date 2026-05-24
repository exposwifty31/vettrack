import { Router } from "express";
import { z } from "zod";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, operationalMetrics } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { isMetricsEnabled } from "../services/operational-metrics.service.js";

const router = Router();

const summaryQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

router.get("/operational-metrics/summary", requireAuth, async (req, res) => {
  const parse = summaryQuerySchema.safeParse(req.query);
  if (!parse.success) {
    return apiError(req, res, "errors.invalidInput", undefined, 400);
  }

  const clinicId = req.clinicId!;
  const now = new Date();
  const fromDate = parse.data.from ? new Date(parse.data.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const toDate = parse.data.to ? new Date(parse.data.to) : now;

  const rows = await db
    .select({
      eventType: operationalMetrics.eventType,
      count: sql<number>`count(*)`,
      avgDurationMs: sql<number | null>`avg(${operationalMetrics.durationMs})`,
    })
    .from(operationalMetrics)
    .where(
      and(
        eq(operationalMetrics.clinicId, clinicId),
        gte(operationalMetrics.createdAt, fromDate),
        lte(operationalMetrics.createdAt, toDate),
      ),
    )
    .groupBy(operationalMetrics.eventType);

  const byType: Record<string, { count: number; avgMs: number | null }> = {};
  for (const row of rows) {
    byType[row.eventType] = { count: Number(row.count), avgMs: row.avgDurationMs ? Number(row.avgDurationMs) : null };
  }

  const successCount = byType["deployable_success"]?.count ?? 0;
  const failCount = byType["bundle_failed"]?.count ?? 0;
  const deployableSuccessRate =
    successCount + failCount > 0 ? successCount / (successCount + failCount) : null;

  return res.json({
    emergencyOverrides: byType["emergency_override"]?.count ?? 0,
    bundleFailures: byType["bundle_failed"]?.count ?? 0,
    staleConditions: byType["condition_stale"]?.count ?? 0,
    procedureBounds: byType["procedure_bound"]?.count ?? 0,
    averageCheckoutMs: byType["checkout_duration"]?.avgMs ?? null,
    averageDockReturnMs: byType["dock_return_duration"]?.avgMs ?? null,
    deployableSuccessRate,
    metricsEnabled: isMetricsEnabled(),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  });
});

export default router;
