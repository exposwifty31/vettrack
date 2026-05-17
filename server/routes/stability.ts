import { Router, type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import {
  runAllTests,
  getReport,
  isTestRunning,
  setTestMode,
  setSchedule,
  getScheduleHours,
  testModeEnabled,
} from "../lib/test-runner.js";
import { getActionLogs, clearActionLogs, logAction } from "../lib/stability-log.js";
import { apiError as i18nApiError } from "../lib/apiError.js";

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

function requireNotProduction(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === "production") {
    // Phase 6 PR 6.10 light adoption (1 of 1 in stability.ts): swap the
    // local envelope for the i18n-aware `apiError`. Remaining 4xx
    // branches in this file (test-mode required, schedule update, etc.)
    // stay on the legacy local helper for a future migration PR — the
    // file remains on the no-untranslated-api-error allowlist until
    // full migration.
    return i18nApiError(req, res, "errors.stability.notAvailableInProduction", undefined, 403);
  }
  next();
}

router.use(requireAuth);
router.use(requireEffectiveRole("admin"));

router.get("/status", (_req, res) => {
  const report = getReport();
  const running = isTestRunning();
  const scheduleHours = getScheduleHours();
  res.json({
    running,
    testModeEnabled,
    scheduleHours,
    lastRun: report.runId ? report : null,
  });
});

router.post("/run", (_req, res) => {
  const requestId = resolveRequestId(res, _req.headers["x-request-id"]);
  if (isTestRunning()) {
    return res.status(409).json(
      apiError({
        code: "CONFLICT",
        reason: "TEST_RUN_ALREADY_IN_PROGRESS",
        message: "A test run is already in progress",
        requestId,
      }),
    );
  }
  runAllTests().catch((err) =>
    logAction("error", "runner", "Test run failed", String(err))
  );
  res.json({ message: "Test run started", runId: `run-${Date.now()}` });
});

router.get("/results", (_req, res) => {
  res.json(getReport());
});

router.get("/logs", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const search = (req.query.search as string | undefined) || undefined;
  res.json(getActionLogs(limit, search));
});

router.delete("/logs", (_req, res) => {
  clearActionLogs();
  logAction("info", "system", "Action logs cleared by admin");
  res.json({ message: "Logs cleared" });
});

router.post("/test-mode", requireNotProduction, (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const { enabled } = req.body as { enabled: boolean };
  if (typeof enabled !== "boolean") {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "INVALID_TEST_MODE_ENABLED",
        message: "enabled must be a boolean",
        requestId,
      }),
    );
  }
  setTestMode(enabled);
  res.json({ testModeEnabled: enabled });
});

router.post("/schedule", requireNotProduction, (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const { hours } = req.body as { hours: number };
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "INVALID_SCHEDULE_HOURS",
        message: "hours must be a non-negative number",
        requestId,
      }),
    );
  }
  setSchedule(h);
  res.json({ scheduleHours: h, message: h > 0 ? `Tests scheduled every ${h} hour(s)` : "Schedule disabled" });
});

export default router;
