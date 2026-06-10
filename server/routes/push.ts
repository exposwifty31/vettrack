import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, pushSubscriptions } from "../db.js";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { authSensitiveLimiter, pushTestLimiter } from "../middleware/rate-limiters.js";
import { sendPushToUser, getVapidPublicKey, isVapidReady } from "../lib/push.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

/*
 * PERMISSIONS MATRIX — /api/push
 * ─────────────────────────────────────────────────────
 * GET  /vapid-public-key   public        Retrieve VAPID public key
 * POST /subscribe          student+      Register push subscription
 * PATCH /subscribe         student+      Update subscription settings
 * DELETE /subscribe        student+      Remove push subscription
 * POST /test               student+      Send a test push notification to self
 * ─────────────────────────────────────────────────────
 */

const router = Router();



const subscribeSchema = z.object({
  endpoint: z.string().url("endpoint must be a valid URL"),
  keys: z.object({
    p256dh: z.string().min(1, "p256dh is required"),
    auth: z.string().min(1, "auth is required"),
  }),
  soundEnabled: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
  technicianReturnRemindersEnabled: z.boolean().optional(),
  seniorOwnReturnRemindersEnabled: z.boolean().optional(),
  seniorTeamOverdueAlertsEnabled: z.boolean().optional(),
  adminHourlySummaryEnabled: z.boolean().optional(),
});

const patchSubscribeSchema = z.object({
  endpoint: z.string().url("endpoint must be a valid URL"),
  soundEnabled: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
  technicianReturnRemindersEnabled: z.boolean().optional(),
  seniorOwnReturnRemindersEnabled: z.boolean().optional(),
  seniorTeamOverdueAlertsEnabled: z.boolean().optional(),
  adminHourlySummaryEnabled: z.boolean().optional(),
});

const deleteSubscribeSchema = z.object({
  endpoint: z.string().min(1, "endpoint is required"),
});

router.get("/vapid-public-key", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  const key = await getVapidPublicKey();
  if (!key) {
    return res.status(503).json(
      apiError({
        code: "SERVICE_UNAVAILABLE",
        reason: "PUSH_NOT_CONFIGURED",
        message: "Push notifications not configured",
        requestId,
      }),
    );
  }
  res.json({ publicKey: key });
});

router.post("/subscribe", requireAuth, authSensitiveLimiter, validateBody(subscribeSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!req.authUser?.id) {
    console.error("SUBSCRIBE: missing req.authUser.id");
    return res.status(401).json(
      apiError({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Unauthorized",
        requestId,
      }),
    );
  }

  if (!isVapidReady()) {
    console.error("SUBSCRIBE: VAPID not initialized (keys missing or init failed)");
    return res.status(503).json(
      apiError({
        code: "SERVICE_UNAVAILABLE",
        reason: "PUSH_NOT_CONFIGURED",
        message: "Push notifications not configured",
        requestId,
      }),
    );
  }

  const body = req.body as z.infer<typeof subscribeSchema>;
  const clinicId = req.clinicId!;
  const {
    endpoint,
    keys,
    soundEnabled,
    alertsEnabled,
    technicianReturnRemindersEnabled,
    seniorOwnReturnRemindersEnabled,
    seniorTeamOverdueAlertsEnabled,
    adminHourlySummaryEnabled,
  } = body;

  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "ENDPOINT_REQUIRED",
        message: "endpoint is required",
        requestId,
      }),
    );
  }
  if (!keys?.p256dh || typeof keys.p256dh !== "string" || !keys.p256dh.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "P256DH_REQUIRED",
        message: "keys.p256dh is required",
        requestId,
      }),
    );
  }
  if (!keys?.auth || typeof keys.auth !== "string" || !keys.auth.trim()) {
    return res.status(400).json(
      apiError({
        code: "VALIDATION_FAILED",
        reason: "AUTH_KEY_REQUIRED",
        message: "keys.auth is required",
        requestId,
      }),
    );
  }

  // Insert targets Drizzle columns (server/db.ts pushSubscriptions) — migration 023 aligns DB if needed.
  try {
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
  } catch (err) {
    console.error("SUBSCRIBE DB delete failed:", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PUSH_SUBSCRIBE_SAVE_FAILED",
        message: "Failed to save subscription",
        requestId,
      }),
    );
  }

  try {
    const [sub] = await db
      .insert(pushSubscriptions)
      .values({
        id: randomUUID(),
        clinicId,
        userId: req.authUser.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        soundEnabled: soundEnabled !== false,
        alertsEnabled: alertsEnabled !== false,
        technicianReturnRemindersEnabled: technicianReturnRemindersEnabled !== false,
        seniorOwnReturnRemindersEnabled: seniorOwnReturnRemindersEnabled !== false,
        seniorTeamOverdueAlertsEnabled: seniorTeamOverdueAlertsEnabled !== false,
        adminHourlySummaryEnabled: adminHourlySummaryEnabled !== false,
      })
      .returning();

    if (!sub) {
      console.error("SUBSCRIBE DB insert returned no row");
      return res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "PUSH_SUBSCRIBE_SAVE_FAILED",
          message: "Failed to save subscription",
          requestId,
        }),
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("SUBSCRIBE DB insert failed:", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PUSH_SUBSCRIBE_SAVE_FAILED",
        message: "Failed to save subscription",
        requestId,
      }),
    );
  }
});

router.patch("/subscribe", requireAuth, validateBody(patchSubscribeSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const {
      endpoint,
      soundEnabled,
      alertsEnabled,
      technicianReturnRemindersEnabled,
      seniorOwnReturnRemindersEnabled,
      seniorTeamOverdueAlertsEnabled,
      adminHourlySummaryEnabled,
    } = req.body as z.infer<typeof patchSubscribeSchema>;

    await db
      .update(pushSubscriptions)
      .set({
        ...(soundEnabled !== undefined && { soundEnabled }),
        ...(alertsEnabled !== undefined && { alertsEnabled }),
        ...(technicianReturnRemindersEnabled !== undefined && { technicianReturnRemindersEnabled }),
        ...(seniorOwnReturnRemindersEnabled !== undefined && { seniorOwnReturnRemindersEnabled }),
        ...(seniorTeamOverdueAlertsEnabled !== undefined && { seniorTeamOverdueAlertsEnabled }),
        ...(adminHourlySummaryEnabled !== undefined && { adminHourlySummaryEnabled }),
      })
      .where(
        and(
          eq(pushSubscriptions.clinicId, clinicId),
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.userId, req.authUser!.id)
        )
      );

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PUSH_SUBSCRIBE_UPDATE_FAILED",
        message: "Failed to update subscription settings",
        requestId,
      }),
    );
  }
});

router.delete("/subscribe", requireAuth, validateBody(deleteSubscribeSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { endpoint } = req.body as z.infer<typeof deleteSubscribeSchema>;

    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.clinicId, clinicId),
          eq(pushSubscriptions.endpoint, endpoint),
          eq(pushSubscriptions.userId, req.authUser!.id)
        )
      );

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PUSH_SUBSCRIBE_DELETE_FAILED",
        message: "Failed to remove subscription",
        requestId,
      }),
    );
  }
});

router.post("/test", requireAuth, pushTestLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!isVapidReady()) {
      return res.status(503).json(
        apiError({
          code: "SERVICE_UNAVAILABLE",
          reason: "PUSH_NOT_CONFIGURED",
          message: "Push is not configured on the server (VAPID keys missing or init failed).",
          requestId,
        }),
      );
    }

    const userId = req.authUser!.id;
    const clinicId = req.clinicId!;
    const subscriptions = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.clinicId, clinicId), eq(pushSubscriptions.userId, userId)));

    if (subscriptions.length === 0) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "PUSH_SUBSCRIPTION_NOT_FOUND",
          message:
            "No push subscription saved for your account. Turn device notifications off and on again in Settings.",
          requestId,
        }),
      );
    }

    await sendPushToUser(clinicId, userId, {
      title: "VetTrack Test",
      body: "Push notifications are working correctly on this device!",
      tag: "test",
      url: "/",
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to send test notification";
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PUSH_TEST_FAILED",
        message,
        requestId,
      }),
    );
  }
});

export default router;
