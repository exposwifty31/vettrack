import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getSyncMetrics } from "../lib/sync-metrics.js";
import { getMetricsSnapshot } from "../lib/metrics.js";
import {
  getAccessDeniedLogSafetySnapshot,
  getAccessDeniedMetricsSnapshot,
  getAccessDeniedMetricsWindowSnapshot,
} from "../lib/access-denied.js";
import { getAlertEngineSnapshot } from "../lib/alert-engine.js";
import { getSystemWatchdogStatus } from "../lib/system-watchdog.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();



router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const uptimeSeconds = Math.floor(process.uptime());
    const memUsage = process.memoryUsage();

    const syncMetrics = getSyncMetrics();
    const runtimeMetrics = getMetricsSnapshot();
    const accessDeniedMetrics = getAccessDeniedMetricsSnapshot();
    const accessDeniedWindow = getAccessDeniedMetricsWindowSnapshot();
    const alertEngine = getAlertEngineSnapshot();
    const watchdog = getSystemWatchdogStatus();
    const accessDeniedLogSafety = getAccessDeniedLogSafetySnapshot();

    res.json({
      ...runtimeMetrics,
      uptime: uptimeSeconds,
      memoryMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      memoryTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
      syncMetrics,
      accessDeniedMetrics,
      accessDeniedWindow,
      alertCounts: alertEngine.counts,
      lastAlertTimestamp: alertEngine.lastAlertAt,
      systemDegraded: alertEngine.isDegraded,
      watchdogStatus: watchdog,
      logSafety: {
        accessDenied: accessDeniedLogSafety,
        alerts: alertEngine.logSafety,
      },
    });
  } catch (err) {
    console.error("Metrics error:", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "METRICS_FETCH_FAILED",
        message: "Failed to fetch metrics",
        requestId,
      }),
    );
  }
});

export default router;
