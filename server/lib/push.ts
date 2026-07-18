import webpush from "web-push";
import { db, pool, pushSubscriptions, serverConfig, users } from "../db.js";
import { and, eq, isNull } from "drizzle-orm";
import * as Sentry from "@sentry/node";
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker.js";
import { incrementMetric } from "./metrics.js";
import { insertRealtimeDomainEvent } from "./realtime-outbox.js";
import { withTimeout } from "./timeout.js";

let vapidReady = false;

/** True when public + private VAPID keys are loaded and web-push is configured. */
export function isVapidReady(): boolean {
  return vapidReady;
}

export async function initVapid(): Promise<void> {
  try {
    let publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
    let privateKey = process.env.VAPID_PRIVATE_KEY ?? "";

    if (publicKey && privateKey) {
      webpush.setVapidDetails("mailto:admin@vettrack.app", publicKey, privateKey);
      vapidReady = true;
      console.log("✅ VAPID initialized from environment");
      return;
    }

    const rows = await db
      .select()
      .from(serverConfig)
      .where(eq(serverConfig.key, "vapid_public_key"));

    if (rows.length === 0) {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;

      await db
        .insert(serverConfig)
        .values([
          { key: "vapid_public_key", value: publicKey },
          { key: "vapid_private_key", value: privateKey },
        ])
        .onConflictDoNothing();

      console.log("✅ VAPID keys generated and stored in database");
    } else {
      publicKey = rows[0].value;
      const privRows = await db
        .select()
        .from(serverConfig)
        .where(eq(serverConfig.key, "vapid_private_key"));
      privateKey = privRows[0]?.value ?? "";
    }

    if (publicKey && privateKey) {
      webpush.setVapidDetails("mailto:admin@vettrack.app", publicKey, privateKey);
      vapidReady = true;
      console.log("✅ VAPID initialized");
    } else {
      console.warn("⚠️  VAPID private key missing — push disabled");
    }
  } catch (err) {
    console.error("❌ VAPID init failed:", err);
  }
}

export async function getVapidPublicKey(): Promise<string | null> {
  // Only expose a public key the server can actually sign with (matches isVapidReady()).
  if (!isVapidReady()) return null;
  // The env pair wins only when both keys are present — mirrors initVapid()'s preference.
  // A lone VAPID_PUBLIC_KEY does not identify the signing pair (initVapid falls through to DB).
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return process.env.VAPID_PUBLIC_KEY;
  }
  try {
    const rows = await db
      .select()
      .from(serverConfig)
      .where(eq(serverConfig.key, "vapid_public_key"));
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  silent?: boolean;
}

/** Correlates Web Push delivery with a `NOTIFICATION_REQUESTED` outbox row (`vt_event_outbox.id`). */
export interface PushDeliveryContext {
  requestedOutboxId?: number;
  /** When true, skips NOTIFICATION_SENT / NOTIFICATION_FAILED inserts so the caller can aggregate (multi-send flows). */
  deferTerminalOutbox?: boolean;
}

export interface PushSendResult {
  deliveredAny: boolean;
  transientFailures: number;
  invalidOrGoneCount: number;
}

function mergePushStats(a: PushSendResult, b: PushSendResult): PushSendResult {
  return {
    deliveredAny: a.deliveredAny || b.deliveredAny,
    transientFailures: a.transientFailures + b.transientFailures,
    invalidOrGoneCount: a.invalidOrGoneCount + b.invalidOrGoneCount,
  };
}

function assertClinicId(clinicId: string): void {
  if (!clinicId || clinicId.trim() === "") {
    throw new Error("Missing clinicId for push operation");
  }
}

const dedupeCache = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;

function isDuplicate(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = dedupeCache.get(key);
  if (last && now - last < windowMs) return true;
  dedupeCache.set(key, now);
  setTimeout(() => dedupeCache.delete(key), windowMs);
  return false;
}

/** @param windowMs Optional window (default 60s). Use 3_600_000 for hourly reminders. */
export function checkDedupe(equipmentId: string, eventType: string, windowMs: number = DEDUPE_WINDOW_MS): boolean {
  return isDuplicate(`${equipmentId}:${eventType}`, windowMs);
}

const PUSH_DISPATCH_ATTEMPTS = 3;
const TRANSIENT_BACKOFF_MS = [500, 1500, 3500];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushStatusCode(err: unknown): number | undefined {
  const e = err as { statusCode?: number };
  return typeof e?.statusCode === "number" ? e.statusCode : undefined;
}

/** Whether this HTTP status should be retried with backoff (rate limits + server errors + unknown/network). */
function isTransientPushFailure(statusCode: number | undefined): boolean {
  if (statusCode === undefined) return true;
  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  return false;
}

async function dispatchToSub(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string,
): Promise<"ok" | "expired" | "invalid" | "error"> {
  if (isCircuitOpen("push")) {
    return "error";
  }
  if (process.env.SENTRY_DSN) {
    Sentry.addBreadcrumb({
      category: "push.send",
      message: `Push dispatch → ${sub.endpoint.slice(-30)}`,
      level: "info",
    });
  }

  for (let attempt = 0; attempt < PUSH_DISPATCH_ATTEMPTS; attempt++) {
    try {
      await withTimeout(
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: 60 },
        ),
        5000,
        "web-push send",
      );
      recordSuccess("push");
      incrementMetric("notifications_sent");
      return "ok";
    } catch (err: unknown) {
      recordFailure("push");
      const statusCode = pushStatusCode(err);

      if (statusCode === 404 || statusCode === 410) {
        incrementMetric("notifications_failed");
        return "expired";
      }

      if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
        if (process.env.SENTRY_DSN) {
          Sentry.captureEvent({
            message: "Push notification send failed (invalid subscription)",
            level: "warning",
            tags: { "push.failure": "true", "push.invalid": "true" },
            extra: { endpoint: sub.endpoint.slice(-40), statusCode },
          });
        }
        incrementMetric("notifications_failed");
        return "invalid";
      }

      const transient = isTransientPushFailure(statusCode);
      if (transient && attempt < PUSH_DISPATCH_ATTEMPTS - 1) {
        await sleep(TRANSIENT_BACKOFF_MS[attempt] ?? 2000);
        continue;
      }

      if (process.env.SENTRY_DSN) {
        Sentry.captureEvent({
          message: "Push notification send failed",
          level: "error",
          tags: { "push.failure": "true" },
          extra: {
            endpoint: sub.endpoint.slice(-40),
            statusCode: statusCode ?? "unknown",
            attempts: attempt + 1,
          },
        });
      }

      incrementMetric("notifications_failed");
      return "error";
    }
  }

  return "error";
}

async function cleanupExpiredEndpoints(endpoints: string[]): Promise<void> {
  for (const endpoint of endpoints) {
    await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .catch(() => {});
  }
}

/** Completes the NOTIFICATION_REQUESTED → terminal outcome chain when Web Push cannot deliver. */
async function emitNotificationFailedOutbox(clinicId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "NOTIFICATION_FAILED",
        payload,
      });
    });
  } catch (err) {
    console.error("[push] NOTIFICATION_FAILED outbox insert failed:", err instanceof Error ? err.message : err);
  }
}

/** Single terminal event for a deferred multi-send notification request. */
async function finalizeNotificationRequestOutbox(
  clinicId: string,
  requestedOutboxId: number,
  stats: PushSendResult,
): Promise<void> {
  const trimmed = clinicId.trim();
  if (!trimmed) return;

  if (stats.deliveredAny) {
    await db.transaction(async (tx) => {
      await insertRealtimeDomainEvent(tx, {
        clinicId: trimmed,
        type: "NOTIFICATION_SENT",
        payload: { requestedOutboxId, scope: "aggregate" },
      });
    });
    return;
  }

  if (stats.transientFailures === 0 && stats.invalidOrGoneCount === 0) {
    await emitNotificationFailedOutbox(trimmed, {
      requestedOutboxId,
      reason: "no_active_subscription",
    });
    return;
  }

  const reason =
    stats.transientFailures > 0 && stats.invalidOrGoneCount === 0 ? "max_retries_exceeded" : "invalid_subscription";
  await emitNotificationFailedOutbox(trimmed, {
    requestedOutboxId,
    reason,
    failedSubscriptions: stats.transientFailures,
    invalidSubscriptions: stats.invalidOrGoneCount,
  });
}

/** F8 / P2.3 — when true, skip hardcoded English equipment broadcast pushes (Railway: PILOT_DISABLE_EN_PUSH=true). */
export function shouldSendPilotEnglishEquipmentPush(): boolean {
  return process.env.PILOT_DISABLE_EN_PUSH !== "true";
}

export async function sendPushToAll(
  clinicId: string,
  payload: PushPayload,
  delivery?: PushDeliveryContext,
): Promise<PushSendResult> {
  assertClinicId(clinicId);
  if (!vapidReady) {
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.clinicId, clinicId));
  if (subs.length === 0) {
    if (delivery?.requestedOutboxId !== undefined && !delivery.deferTerminalOutbox) {
      await emitNotificationFailedOutbox(clinicId, {
        scope: "all",
        reason: "no_active_subscription",
        requestedOutboxId: delivery.requestedOutboxId,
        tag: payload.tag ?? null,
        title: payload.title,
      });
    }
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const expired: string[] = [];
  let deliveredAny = false;
  let transientFailures = 0;
  let invalidOrGoneCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.alertsEnabled) return;

      const effectiveSilent = !sub.soundEnabled ? true : (payload.silent ?? false);
      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        url: payload.url,
        silent: effectiveSilent,
      });

      const result = await dispatchToSub(sub, notificationPayload);
      if (result === "ok") deliveredAny = true;
      if (result === "expired" || result === "invalid") {
        expired.push(sub.endpoint);
        invalidOrGoneCount += 1;
      }
      if (result === "error") transientFailures += 1;
    }),
  );

  if (expired.length > 0) await cleanupExpiredEndpoints(expired);

  const attemptedAny = subs.some((s) => s.alertsEnabled);
  const defer = delivery?.deferTerminalOutbox === true;
  if (!defer && attemptedAny && !deliveredAny && (transientFailures > 0 || invalidOrGoneCount > 0)) {
    const reason =
      transientFailures > 0 && invalidOrGoneCount === 0 ? "max_retries_exceeded" : "invalid_subscription";
    await emitNotificationFailedOutbox(clinicId, {
      scope: "all",
      failedSubscriptions: transientFailures,
      expiredSubscriptions: invalidOrGoneCount,
      tag: payload.tag ?? null,
      title: payload.title,
      ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
      reason,
    });
  }

  if (!defer && deliveredAny) {
    await db.transaction(async (tx) => {
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "NOTIFICATION_SENT",
        payload: {
          scope: "all",
          tag: payload.tag ?? null,
          title: payload.title,
          ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
        },
      });
    });
  }

  return { deliveredAny, transientFailures, invalidOrGoneCount };
}

export async function sendPushToRole(
  clinicId: string,
  role: string,
  payload: PushPayload,
  delivery?: PushDeliveryContext,
): Promise<PushSendResult> {
  assertClinicId(clinicId);

  const allSubs = await db.select({
    endpoint: pushSubscriptions.endpoint,
    p256dh: pushSubscriptions.p256dh,
    auth: pushSubscriptions.auth,
    alertsEnabled: pushSubscriptions.alertsEnabled,
    soundEnabled: pushSubscriptions.soundEnabled,
    userId: pushSubscriptions.userId,
  }).from(pushSubscriptions).where(eq(pushSubscriptions.clinicId, clinicId));

  if (allSubs.length === 0) {
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const userRows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.clinicId, clinicId), isNull(users.deletedAt)));
  const roleMap = new Map(userRows.map((u) => [u.id, u.role]));

  const subs = allSubs.filter((s) => roleMap.get(s.userId) === role);
  const defer = delivery?.deferTerminalOutbox === true;
  if (subs.length === 0) {
    if (delivery?.requestedOutboxId !== undefined && !defer) {
      await emitNotificationFailedOutbox(clinicId, {
        scope: "role",
        role,
        reason: "no_active_subscription",
        requestedOutboxId: delivery.requestedOutboxId,
        recipientCount: 0,
        tag: payload.tag ?? null,
        title: payload.title,
      });
    }
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const expired: string[] = [];
  let transientFailures = 0;
  let invalidOrGoneCount = 0;
  let deliveredRoleCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const effectiveSilent = !sub.soundEnabled ? true : (payload.silent ?? false);
      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        url: payload.url,
        silent: effectiveSilent,
      });
      const result = await dispatchToSub(sub, notificationPayload);
      if (result === "expired" || result === "invalid") {
        expired.push(sub.endpoint);
        invalidOrGoneCount += 1;
      }
      if (result === "error") transientFailures += 1;
      if (result === "ok") {
        deliveredRoleCount += 1;
        if (!defer) {
          await db.transaction(async (tx) => {
            await insertRealtimeDomainEvent(tx, {
              clinicId,
              type: "NOTIFICATION_SENT",
              payload: {
                scope: "role",
                role,
                userId: sub.userId,
                tag: payload.tag ?? null,
                title: payload.title,
                ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
              },
            });
          });
        }
      }
    }),
  );

  if (expired.length > 0) await cleanupExpiredEndpoints(expired);

  if (
    !defer &&
    subs.length > 0 &&
    deliveredRoleCount === 0 &&
    (transientFailures > 0 || invalidOrGoneCount > 0)
  ) {
    const reason =
      transientFailures > 0 && invalidOrGoneCount === 0 ? "max_retries_exceeded" : "invalid_subscription";
    await emitNotificationFailedOutbox(clinicId, {
      scope: "role",
      role,
      failedSubscriptions: transientFailures,
      expiredSubscriptions: invalidOrGoneCount,
      recipientCount: subs.length,
      tag: payload.tag ?? null,
      title: payload.title,
      ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
      reason,
    });
  }

  return {
    deliveredAny: deliveredRoleCount > 0,
    transientFailures,
    invalidOrGoneCount,
  };
}

export async function sendPushToOthers(
  clinicId: string,
  excludeUserId: string,
  payload: PushPayload,
  delivery?: PushDeliveryContext,
): Promise<PushSendResult> {
  assertClinicId(clinicId);
  if (!vapidReady) {
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const allSubs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.clinicId, clinicId));
  const subs = allSubs.filter((s) => s.userId !== excludeUserId);
  if (subs.length === 0) {
    if (delivery?.requestedOutboxId !== undefined && !delivery.deferTerminalOutbox) {
      await emitNotificationFailedOutbox(clinicId, {
        scope: "others",
        excludeUserId,
        reason: "no_active_subscription",
        requestedOutboxId: delivery.requestedOutboxId,
        tag: payload.tag ?? null,
        title: payload.title,
      });
    }
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const expired: string[] = [];
  let deliveredAny = false;
  let transientFailures = 0;
  let invalidOrGoneCount = 0;
  const defer = delivery?.deferTerminalOutbox === true;

  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.alertsEnabled) return;

      const effectiveSilent = !sub.soundEnabled ? true : (payload.silent ?? false);
      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        url: payload.url,
        silent: effectiveSilent,
      });

      const result = await dispatchToSub(sub, notificationPayload);
      if (result === "ok") deliveredAny = true;
      if (result === "expired" || result === "invalid") {
        expired.push(sub.endpoint);
        invalidOrGoneCount += 1;
      }
      if (result === "error") transientFailures += 1;
    }),
  );

  if (expired.length > 0) await cleanupExpiredEndpoints(expired);

  const attemptedAny = subs.some((s) => s.alertsEnabled);
  if (!defer && attemptedAny && !deliveredAny && (transientFailures > 0 || invalidOrGoneCount > 0)) {
    const reason =
      transientFailures > 0 && invalidOrGoneCount === 0 ? "max_retries_exceeded" : "invalid_subscription";
    await emitNotificationFailedOutbox(clinicId, {
      scope: "others",
      excludeUserId,
      failedSubscriptions: transientFailures,
      expiredSubscriptions: invalidOrGoneCount,
      tag: payload.tag ?? null,
      title: payload.title,
      ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
      reason,
    });
  }

  if (!defer && deliveredAny) {
    await db.transaction(async (tx) => {
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "NOTIFICATION_SENT",
        payload: {
          scope: "others",
          excludeUserId,
          tag: payload.tag ?? null,
          title: payload.title,
          ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
        },
      });
    });
  }

  return { deliveredAny, transientFailures, invalidOrGoneCount };
}

export async function sendPushToUser(
  clinicId: string,
  userId: string,
  payload: PushPayload,
  delivery?: PushDeliveryContext,
): Promise<PushSendResult> {
  assertClinicId(clinicId);
  if (!vapidReady) {
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.clinicId, clinicId), eq(pushSubscriptions.userId, userId)));

  const defer = delivery?.deferTerminalOutbox === true;

  if (subs.length === 0) {
    if (delivery?.requestedOutboxId !== undefined && !defer) {
      await emitNotificationFailedOutbox(clinicId, {
        scope: "user",
        userId,
        reason: "no_active_subscription",
        requestedOutboxId: delivery.requestedOutboxId,
        tag: payload.tag ?? null,
        title: payload.title,
      });
    }
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const expired: string[] = [];
  let deliveredCount = 0;
  let transientFailures = 0;
  let invalidOrGoneCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const effectiveSilent = !sub.soundEnabled ? true : (payload.silent ?? false);
      const notificationPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        tag: payload.tag,
        url: payload.url,
        silent: effectiveSilent,
      });

      const result = await dispatchToSub(sub, notificationPayload);
      if (result === "ok") deliveredCount += 1;
      if (result === "error") transientFailures += 1;
      if (result === "expired" || result === "invalid") {
        expired.push(sub.endpoint);
        invalidOrGoneCount += 1;
      }
      if (result === "ok" && !defer) {
        await db.transaction(async (tx) => {
          await insertRealtimeDomainEvent(tx, {
            clinicId,
            type: "NOTIFICATION_SENT",
            payload: {
              scope: "user",
              userId,
              tag: payload.tag ?? null,
              title: payload.title,
              ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
            },
          });
        });
      }
    }),
  );

  if (expired.length > 0) await cleanupExpiredEndpoints(expired);

  if (
    !defer &&
    subs.length > 0 &&
    deliveredCount === 0 &&
    (transientFailures > 0 || invalidOrGoneCount > 0)
  ) {
    const reason =
      transientFailures > 0 && invalidOrGoneCount === 0 ? "max_retries_exceeded" : "invalid_subscription";
    await emitNotificationFailedOutbox(clinicId, {
      scope: "user",
      userId,
      failedSubscriptions: transientFailures,
      expiredSubscriptions: invalidOrGoneCount,
      tag: payload.tag ?? null,
      title: payload.title,
      ...(delivery?.requestedOutboxId !== undefined ? { requestedOutboxId: delivery.requestedOutboxId } : {}),
      reason,
    });
  }

  return {
    deliveredAny: deliveredCount > 0,
    transientFailures,
    invalidOrGoneCount,
  };
}

const PUSH_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let pushCleanupSchedulerStarted = false;

/** Remove subscriptions for soft-deleted or removed users (table hygiene; 410/404 cleanup happens on send). */
async function cleanupStalePushSubscriptions(): Promise<void> {
  const result = await pool.query(`
    DELETE FROM vt_push_subscriptions
    WHERE user_id IN (SELECT id FROM vt_users WHERE deleted_at IS NOT NULL)
       OR user_id NOT IN (SELECT id FROM vt_users)
  `);
  const deleted = result.rowCount ?? 0;
  if (deleted > 0) {
    console.log(`[push-cleanup] removed ${deleted} stale subscription(s)`);
  }
}

export function startPushCleanupScheduler(): void {
  if (pushCleanupSchedulerStarted) return;
  pushCleanupSchedulerStarted = true;

  cleanupStalePushSubscriptions().catch((err) => {
    console.error("[push-cleanup] startup run failed:", err);
  });

  setInterval(() => {
    cleanupStalePushSubscriptions().catch((err) => {
      console.error("[push-cleanup] scheduled run failed:", err);
    });
  }, PUSH_CLEANUP_INTERVAL_MS);
}
