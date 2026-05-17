import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, equipment, equipmentReturns, scheduledNotifications } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { isTestMode } from "../lib/test-mode.js";
import {
  runHourlySmartNotifications,
  runScheduledNotifications,
} from "../lib/role-notification-scheduler.js";
import { runExpiryCheckWorker } from "../workers/expiryCheckWorker.js";
import { runChargeAlertJobForReturn } from "../workers/chargeAlertWorker.js";
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

// Phase 5-style local envelope helper, retained for the remaining 4xx/5xx
// branches in this file. Phase 6 PR 6.10 (and subsequent migration PRs)
// will continue swapping individual sites over to `i18nApiError`.
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
    // Phase 6 PR 6.3 light adoption (1 of 2): swap the local envelope for
    // the i18n-aware helper. This branch is a deny gate with no
    // production client consumer that depends on the legacy envelope
    // shape; the i18n migration is safe.
    return i18nApiError(req, res, "errors.test.notAvailableInProduction", undefined, 403);
  }
  next();
}

router.use(requireNotProduction);

function requireTestMode(req: Request, res: Response, next: NextFunction) {
  if (!isTestMode()) {
    // Phase 6 PR 6.3 light adoption (2 of 2).
    return i18nApiError(req, res, "errors.notFound", undefined, 404);
  }
  next();
}

const createScenarioSchema = z.object({
  equipmentId: z.string().uuid(),
});

/** POST /api/test/run-scheduler — run scheduled notification processors once (return reminders + smart hourly). */
router.post("/run-scheduler", requireAuth, requireTestMode, async (_req, res) => {
  await runScheduledNotifications();
  await runHourlySmartNotifications({ force: true });
  res.json({ success: true });
});

/** POST /api/test/create-scenario — insert a due return_reminder for equipment you have checked out (for push testing). */
router.post(
  "/create-scenario",
  requireAuth,
  requireTestMode,
  validateBody(createScenarioSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const { equipmentId } = req.body as z.infer<typeof createScenarioSchema>;
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;

    const [item] = await db
      .select({
        id: equipment.id,
        name: equipment.name,
        checkedOutById: equipment.checkedOutById,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), eq(equipment.id, equipmentId), isNull(equipment.deletedAt)))
      .limit(1);

    if (!item) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "EQUIPMENT_NOT_FOUND",
          message: "Equipment not found",
          requestId,
        }),
      );
    }
    if (item.checkedOutById !== userId) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "EQUIPMENT_NOT_CHECKED_OUT_BY_USER",
          message: "Equipment must be checked out by you for this scenario",
          requestId,
        }),
      );
    }

    await db
      .delete(scheduledNotifications)
      .where(
        and(
          eq(scheduledNotifications.type, "return_reminder"),
          eq(scheduledNotifications.clinicId, clinicId),
          eq(scheduledNotifications.userId, userId),
          eq(scheduledNotifications.equipmentId, equipmentId),
          isNull(scheduledNotifications.sentAt)
        )
      );

    const [row] = await db
      .insert(scheduledNotifications)
      .values({
        clinicId,
        type: "return_reminder",
        userId,
        equipmentId,
        scheduledAt: new Date(Date.now() - 2_000),
        payload: { equipmentName: item.name, testScenario: true },
      })
      .returning({ id: scheduledNotifications.id });

    res.status(201).json({ success: true, scheduledNotificationId: row?.id });
  }
);

/** GET /api/test/notifications — recent scheduled notifications for the current user. */
router.get("/notifications", requireAuth, requireTestMode, async (req, res) => {
  const userId = req.authUser!.id;
  const clinicId = req.clinicId!;
  const rows = await db
    .select({
      id: scheduledNotifications.id,
      type: scheduledNotifications.type,
      equipmentId: scheduledNotifications.equipmentId,
      scheduledAt: scheduledNotifications.scheduledAt,
      sentAt: scheduledNotifications.sentAt,
      payload: scheduledNotifications.payload,
    })
    .from(scheduledNotifications)
    .where(and(eq(scheduledNotifications.clinicId, clinicId), eq(scheduledNotifications.userId, userId)))
    .orderBy(desc(scheduledNotifications.scheduledAt))
    .limit(100);

  res.json({ notifications: rows });
});

/** POST /api/test/expiry-check/run — run expiry-check worker once. */
router.post("/expiry-check/run", requireAuth, requireTestMode, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const notifiedCount = await runExpiryCheckWorker();
    res.json({ success: true, notifiedCount });
  } catch (error) {
    console.error("[test] expiry-check run failed", error);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "EXPIRY_CHECK_RUN_FAILED",
        message: "Failed to run expiry check",
        requestId,
      }),
    );
  }
});

const runChargeAlertSchema = z.object({
  returnId: z.string().uuid(),
});

/** POST /api/test/charge-alert/run — run a single charge-alert job by return id. */
router.post("/charge-alert/run", requireAuth, requireTestMode, validateBody(runChargeAlertSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const { returnId } = req.body as z.infer<typeof runChargeAlertSchema>;
    const clinicId = req.clinicId!;
    const { notified } = await runChargeAlertJobForReturn(returnId, clinicId);
    res.json({ success: true, alerted: notified });
  } catch (error) {
    console.error("[test] charge-alert run failed", error);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "CHARGE_ALERT_RUN_FAILED",
        message: "Failed to run charge alert",
        requestId,
      }),
    );
  }
});

router.get("/returns/:id", requireAuth, requireTestMode, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const clinicId = req.clinicId!;
  const returnId = req.params.id;
  try {
    const [row] = await db
      .select()
      .from(equipmentReturns)
      .where(and(eq(equipmentReturns.id, returnId), eq(equipmentReturns.clinicId, clinicId)))
      .limit(1);
    if (!row) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "RETURN_NOT_FOUND",
          message: "Return not found",
          requestId,
        }),
      );
    }
    res.json({ return: row });
  } catch (error) {
    console.error("[test] returns fetch failed", error);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "RETURN_FETCH_FAILED",
        message: "Failed to fetch return",
        requestId,
      }),
    );
  }
});

export default router;
