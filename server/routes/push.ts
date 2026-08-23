import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, pushSubscriptions } from "../db.js";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { authSensitiveLimiter, pushTestLimiter } from "../middleware/rate-limiters.js";
import {
  sendPushToUser,
  getVapidPublicKey,
  isVapidReady,
  isPushReady,
  whenPushInitialized,
} from "../lib/push.js";
import { subscribeSchema, isNativeSubscribeBody, type SubscribeBody } from "../lib/push-subscription-schema.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";

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

// Resolve the refine-guaranteed endpoint|token into a discriminated identifier so
// the handler builds the row predicate by switching on `by` — no nullable branch,
// no `!` assertion. `?? ""` is an unreachable typesafe fallback for the token arm
// (the refine above rejects a body carrying neither, so it never runs).
function toIdentifier(v: { endpoint?: string; token?: string }) {
  return v.endpoint
    ? ({ by: "endpoint", value: v.endpoint } as const)
    : ({ by: "token", value: v.token ?? "" } as const);
}

const patchSubscribeSchema = z
  .object({
    endpoint: z.string().url("endpoint must be a valid URL").optional(),
    token: z.string().min(1).optional(),
    soundEnabled: z.boolean().optional(),
    alertsEnabled: z.boolean().optional(),
    technicianReturnRemindersEnabled: z.boolean().optional(),
    seniorOwnReturnRemindersEnabled: z.boolean().optional(),
    seniorTeamOverdueAlertsEnabled: z.boolean().optional(),
    adminHourlySummaryEnabled: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.endpoint) || Boolean(v.token), {
    message: "endpoint or token is required",
  })
  .transform((v) => ({ ...v, identifier: toIdentifier(v) }));

const deleteSubscribeSchema = z
  .object({
    endpoint: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.endpoint) || Boolean(v.token), {
    message: "endpoint or token is required",
  })
  .transform((v) => ({ ...v, identifier: toIdentifier(v) }));

router.get("/vapid-public-key", async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  // Wait out the startup init window so a configured server does not hand a
  // web client a false PUSH_NOT_CONFIGURED before initVapid has run.
  await whenPushInitialized();
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

router.post(
  "/subscribe",
  requireAuth,
  authSensitiveLimiter,
  validateBody(subscribeSchema),
  async (req: Request<Record<string, never>, unknown, SubscribeBody>, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);

    // Explicit guards (not `!`/`as`): validateBody already parsed the body, and
    // requireAuth populates authUser — narrow both to non-null before any query.
    const userId = req.authUser?.id;
    if (!userId) {
      console.error("SUBSCRIBE: missing req.authUser.id");
      return res.status(401).json(
        apiError({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }),
      );
    }
    const clinicId = req.clinicId;
    if (!clinicId) {
      return res.status(400).json(
        apiError({ code: "VALIDATION_FAILED", reason: "MISSING_CLINIC_ID", message: "Missing clinic context", requestId }),
      );
    }

    const body = req.body;
    const settings = {
      soundEnabled: body.soundEnabled !== false,
      alertsEnabled: body.alertsEnabled !== false,
      technicianReturnRemindersEnabled: body.technicianReturnRemindersEnabled !== false,
      seniorOwnReturnRemindersEnabled: body.seniorOwnReturnRemindersEnabled !== false,
      seniorTeamOverdueAlertsEnabled: body.seniorTeamOverdueAlertsEnabled !== false,
      adminHourlySummaryEnabled: body.adminHourlySummaryEnabled !== false,
    };
    const saveFailed = () =>
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "PUSH_SUBSCRIBE_SAVE_FAILED",
          message: "Failed to save subscription",
          requestId,
        }),
      );

    if (isNativeSubscribeBody(body)) {
      // Native (APNs/FCM/Expo): store the device token. No VAPID gate — storing a
      // token needs no web-push signing pair, and the native transport's
      // credentials may arrive from the owner later.
      //
      // Atomic upsert on (clinicId, token) — matching the partial unique index
      // ux_vt_push_subscriptions_clinic_token (migration 180). (userId is
      // deliberately not part of the conflict target: the uniqueness key is
      // (clinicId, token), so a shared device re-registered by a different user
      // in the same clinic must replace the row, not 500 on the unique index.
      // Ownership scoping stays on PATCH/DELETE.)
      //
      // RN-Migration #98: delete-then-insert (two statements, even inside one
      // db.transaction) is not atomic against a SECOND transaction racing the
      // same key — under READ COMMITTED, T2's INSERT can block on T1's
      // still-uncommitted unique-index entry and then fail with 23505 once T1
      // commits. A single INSERT ... ON CONFLICT DO UPDATE has no such window:
      // Postgres itself serializes conflicting upserts against the same key.
      //
      // The unique index is PARTIAL (`WHERE token IS NOT NULL`) — target alone
      // is not enough for Postgres to infer it; targetWhere must repeat the
      // exact predicate or the ON CONFLICT clause won't match the index and
      // this reverts to the same 23505 under concurrency.
      try {
        // Detect an ownership transfer INSIDE the tx (SELECT the current owner
        // of this (clinicId, token) before the upsert). The audit itself fires
        // AFTER the tx commits — fire-and-forget, never on the tx client — so
        // it honors the "don't await logAudit in a transaction path"
        // convention and never audits a rolled-back write.
        let priorUserId: string | null = null;
        const [sub] = await db.transaction(async (tx) => {
          const existing = await tx
            .select({ userId: pushSubscriptions.userId })
            .from(pushSubscriptions)
            .where(and(eq(pushSubscriptions.clinicId, clinicId), eq(pushSubscriptions.token, body.token)));
          if (existing[0] && existing[0].userId !== userId) {
            priorUserId = existing[0].userId;
          }
          return tx
            .insert(pushSubscriptions)
            .values({ id: randomUUID(), clinicId, userId, platform: body.platform, token: body.token, ...settings })
            .onConflictDoUpdate({
              target: [pushSubscriptions.clinicId, pushSubscriptions.token],
              targetWhere: sql`${pushSubscriptions.token} IS NOT NULL`,
              // createdAt is refreshed on update too, matching the old
              // delete-then-insert's semantics (admin-notifications.service.ts
              // orders by createdAt DESC as an activity-recency signal — an
              // UPDATE that left it untouched would silently change that
              // ordering, which is a separate concern from the race fix).
              set: { userId, platform: body.platform, createdAt: sql`now()`, ...settings },
            })
            .returning();
        });
        if (!sub) {
          console.error("SUBSCRIBE (native) DB insert returned no row");
          return saveFailed();
        }
        if (priorUserId) {
          // Fire-and-forget (NOT awaited, NOT on the tx client). Metadata carries
          // platform + previousUserId only — never the token (a device secret).
          logAudit({
            clinicId,
            actionType: "push_token_reassigned",
            performedBy: userId,
            performedByEmail: req.authUser?.email ?? "",
            targetId: sub.id,
            targetType: "push_subscription",
            metadata: { platform: body.platform, previousUserId: priorUserId },
            actorRole: resolveAuditActorRole(req),
          });
        }
        return res.json({ success: true });
      } catch (err) {
        console.error("SUBSCRIBE (native) DB write failed:", err);
        return saveFailed();
      }
    }

    // Web-push path — requires the VAPID signing pair (unchanged behavior). Wait
    // out the startup init window first so a configured server does not 503 a
    // legitimate subscribe before initVapid has run.
    await whenPushInitialized();
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

    // `endpoint` is guaranteed here: the schema's web branch is `endpoint:
    // z.string().url()`, so reaching this point (not a native body) means it is a
    // valid URL string — the old `!endpoint` guard was dead. p256dh/auth keep
    // their defensive checks: `z.string().min(1)` admits a whitespace-only string,
    // which `.trim()` still rejects below.
    const { endpoint, keys } = body;
    if (!keys?.p256dh || typeof keys.p256dh !== "string" || !keys.p256dh.trim()) {
      return res.status(400).json(
        apiError({ code: "VALIDATION_FAILED", reason: "P256DH_REQUIRED", message: "keys.p256dh is required", requestId }),
      );
    }
    if (!keys?.auth || typeof keys.auth !== "string" || !keys.auth.trim()) {
      return res.status(400).json(
        apiError({ code: "VALIDATION_FAILED", reason: "AUTH_KEY_REQUIRED", message: "keys.auth is required", requestId }),
      );
    }

    // Replace-then-insert atomically. The delete is scoped to (clinicId, endpoint)
    // — endpoint is globally unique, so this replaces this browser's prior row
    // within the tenant. (userId is deliberately NOT in the predicate: the unique
    // key is the endpoint, so a same-device re-subscribe by a different user must
    // still replace the row rather than 500 on the unique index.)
    try {
      const [sub] = await db.transaction(async (tx) => {
        await tx
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.clinicId, clinicId), eq(pushSubscriptions.endpoint, endpoint)));
        return tx
          .insert(pushSubscriptions)
          .values({
            id: randomUUID(),
            clinicId,
            userId,
            platform: "web",
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            ...settings,
          })
          .returning();
      });

      if (!sub) {
        console.error("SUBSCRIBE DB insert returned no row");
        return saveFailed();
      }
      return res.json({ success: true });
    } catch (err) {
      console.error("SUBSCRIBE DB write failed:", err);
      return saveFailed();
    }
  },
);

router.patch("/subscribe", requireAuth, validateBody(patchSubscribeSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const {
      identifier,
      soundEnabled,
      alertsEnabled,
      technicianReturnRemindersEnabled,
      seniorOwnReturnRemindersEnabled,
      seniorTeamOverdueAlertsEnabled,
      adminHourlySummaryEnabled,
    } = req.body as z.infer<typeof patchSubscribeSchema>;

    // The schema's transform resolved the guaranteed endpoint|token into a
    // discriminated identifier, so the row predicate is built with no null branch.
    const idMatch =
      identifier.by === "endpoint"
        ? eq(pushSubscriptions.endpoint, identifier.value)
        : eq(pushSubscriptions.token, identifier.value);

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
          idMatch,
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
    const { identifier } = req.body as z.infer<typeof deleteSubscribeSchema>;

    // The schema's transform resolved the guaranteed endpoint|token into a
    // discriminated identifier, so the row predicate is built with no null branch.
    const idMatch =
      identifier.by === "endpoint"
        ? eq(pushSubscriptions.endpoint, identifier.value)
        : eq(pushSubscriptions.token, identifier.value);

    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.clinicId, clinicId),
          idMatch,
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
    // Wait out the startup init window: app.listen() accepts requests before the
    // runMigrations() chain runs initVapid/initApns/initFcm, so a /test that lands
    // in that window would read isPushReady() === false on a configured server.
    await whenPushInitialized();
    // Transport-neutral: a test push can go over ANY configured transport
    // (web-push VAPID, APNs, or FCM), so an APNs-only or FCM-only deployment is
    // accepted here — the per-subscription dispatcher still routes by platform.
    if (!isPushReady()) {
      return res.status(503).json(
        apiError({
          code: "SERVICE_UNAVAILABLE",
          reason: "PUSH_NOT_CONFIGURED",
          message: "Push is not configured on the server (no transport ready).",
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
