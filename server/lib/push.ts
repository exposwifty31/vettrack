import webpush from "web-push";
import { db, pool, pushSubscriptions, serverConfig, users } from "../db.js";
import { and, eq, isNull } from "drizzle-orm";
import * as Sentry from "@sentry/node";
import { buildPushAlertEnvelope, type PushAlertEnvelope } from "@vettrack/contracts";
import { isCircuitOpen, recordFailure, recordSuccess } from "./circuit-breaker.js";
import { incrementMetric } from "./metrics.js";
import { insertRealtimeDomainEvent } from "./realtime-outbox.js";
import { withTimeout } from "./timeout.js";
import type { PushDispatchOutcome } from "./push-types.js";
import { sendApnsPush, isApnsReady } from "./push-apns.js";
import { sendFcmPush, isFcmReady } from "./push-fcm.js";

let vapidReady = false;

/** True when public + private VAPID keys are loaded and web-push is configured. */
export function isVapidReady(): boolean {
  return vapidReady;
}

/** True when ANY push transport can deliver — web-push (VAPID) OR APNs OR FCM. */
export function isPushReady(): boolean {
  return isVapidReady() || isApnsReady() || isFcmReady();
}

// Startup init gate. app.listen() accepts requests before the runMigrations()
// chain runs initVapid/initApns/initFcm, so a readiness check that lands in that
// window would falsely report a configured server as NOT_CONFIGURED. Handlers
// await whenPushInitialized() before checking isPushReady(). The gate is armed
// synchronously at startup (beginPushInitialization) so a request in the window
// waits, and released once the init sequence is attempted (markPushInitialized).
let pushInitResolve: (() => void) | null = null;
let pushInitPromise: Promise<void> | null = null;

/**
 * Arm the startup init gate. Called once, synchronously, before the async init
 * sequence runs so a request that arrives in the listen→init window blocks on
 * whenPushInitialized() instead of racing a not-yet-ready transport check.
 * Idempotent.
 */
export function beginPushInitialization(): void {
  if (pushInitPromise) return;
  pushInitPromise = new Promise<void>((resolve) => {
    pushInitResolve = resolve;
  });
}

/** Release the gate once every transport init has been attempted. Idempotent. */
export function markPushInitialized(): void {
  pushInitResolve?.();
}

/**
 * Resolves once startup push-transport init has been attempted. If init was
 * never begun — test mode, where startBackgroundSchedulers is a no-op — this
 * resolves immediately so a handler never hangs.
 */
export function whenPushInitialized(): Promise<void> {
  return pushInitPromise ?? Promise.resolve();
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
  /** Opaque pointer (e.g. code-blue sessionId) — ADR-009: reference, NOT state. */
  referenceId?: string;
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

/** Row shape the platform dispatcher needs — a superset of every sendPush* select. */
interface DispatchableSubscription {
  platform?: string | null;
  endpoint?: string | null;
  p256dh?: string | null;
  auth?: string | null;
  token?: string | null;
  soundEnabled?: boolean | null;
}

/** Compute the per-subscription silent flag and whitelist-build the alert envelope. */
function buildEnvelopeForSub(sub: DispatchableSubscription, payload: PushPayload): PushAlertEnvelope {
  const effectiveSilent = !sub.soundEnabled ? true : (payload.silent ?? false);
  return buildPushAlertEnvelope({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    url: payload.url,
    silent: effectiveSilent,
    referenceId: payload.referenceId,
  });
}

/**
 * Platform-aware dispatch (ADR-009 §1). Routes ONE subscription row to the
 * correct transport: web → web-push (unchanged), ios → APNs, android|expo → FCM.
 * A transport with no credentials returns "skipped" (graceful degradation, like
 * Redis-optional) so it neither delivers nor counts as a failure. The public
 * sendPush* signatures stay stable — the fan-out lives here.
 */
export async function dispatchToSubscription(
  sub: DispatchableSubscription,
  envelope: PushAlertEnvelope,
): Promise<PushDispatchOutcome> {
  const platform = sub.platform ?? "web";
  if (platform === "ios") {
    if (!isApnsReady()) return "skipped";
    if (!sub.token) return "invalid";
    return recordTransportOutcome(await sendApnsPush(sub.token, envelope));
  }
  if (platform === "android" || platform === "expo") {
    if (!isFcmReady()) return "skipped";
    if (!sub.token) return "invalid";
    return recordTransportOutcome(await sendFcmPush(sub.token, envelope));
  }
  // web (default) — the existing web-push path, payload serialized as before.
  // (dispatchToSub increments notifications_sent/failed internally, so the web
  // branch is NOT wrapped in recordTransportOutcome — that would double-count.)
  if (!isVapidReady()) return "skipped";
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return "invalid";
  return dispatchToSub(
    { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
    JSON.stringify(envelope),
  );
}

/** Feed native (APNs/FCM) send outcomes into the same counters the web path uses. */
function recordTransportOutcome(outcome: PushDispatchOutcome): PushDispatchOutcome {
  if (outcome === "ok") incrementMetric("notifications_sent");
  else if (outcome === "expired" || outcome === "invalid" || outcome === "error") {
    incrementMetric("notifications_failed");
  }
  return outcome;
}

/** Reference to a subscription that failed permanently — cleaned up by whichever id it carries. */
interface ExpiredSubscriptionRef {
  endpoint?: string | null;
  token?: string | null;
}

async function cleanupExpiredSubscriptions(clinicId: string, refs: ExpiredSubscriptionRef[]): Promise<void> {
  for (const ref of refs) {
    try {
      if (ref.token) {
        await db
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.clinicId, clinicId), eq(pushSubscriptions.token, ref.token)));
      } else if (ref.endpoint) {
        await db
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.clinicId, clinicId), eq(pushSubscriptions.endpoint, ref.endpoint)));
      }
    } catch (err) {
      // Contextual operational error only — never log the token/endpoint (device secret).
      console.error("[push] expired-subscription cleanup failed:", err instanceof Error ? err.message : err);
    }
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
  if (!vapidReady && !isApnsReady() && !isFcmReady()) {
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.clinicId, clinicId));
  if (subs.length === 0) {
    return emptyClinicResult(clinicId, payload, delivery);
  }

  // The ONLY difference between routine and emergency delivery. It lives here,
  // in the caller, so the machinery below never receives the preference and
  // therefore cannot consult it — see sendEmergencyPushToAll.
  return deliverToClinicSubscriptions(
    clinicId,
    subs.filter((s) => s.alertsEnabled),
    payload,
    delivery,
  );
}

/**
 * Page every subscription in the clinic, IGNORING the alerts preference.
 *
 * This exists because `alertsEnabled` could silence a Code Blue. It is written
 * from the web console by a toggle labelled "Critical alerts — Enable sound for
 * urgent equipment alerts" (`src/pages/settings.tsx:146`), and both scoping
 * promises in that label were false: it suppresses DELIVERY rather than a
 * sound, and it was not confined to equipment, because `sendPushToAll` skipped
 * the whole subscription and `sendPushToAll` is how `code_blue_broadcast` is
 * delivered. A technician silencing what read as an equipment chime stopped
 * receiving cardiac-arrest pages, silently.
 *
 * A separate function rather than a `bypassPreferences` flag on the existing
 * one, deliberately: a parameter is a gate every future call site has to
 * remember to pass, and the failure mode of forgetting is a missed page. This
 * function does not have the preference in scope at all, and a test asserts its
 * body never names it — a property a flag could not have.
 *
 * The preference still governs ROUTINE pushes, and that is the point rather
 * than a concession: if noise were unmutable too, people would mute VetTrack at
 * the OS level and take Code Blue down with it.
 */
export async function sendEmergencyPushToAll(
  clinicId: string,
  payload: PushPayload,
  delivery?: PushDeliveryContext,
): Promise<PushSendResult> {
  assertClinicId(clinicId);
  if (!vapidReady && !isApnsReady() && !isFcmReady()) {
    return { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.clinicId, clinicId));
  if (subs.length === 0) {
    return emptyClinicResult(clinicId, payload, delivery);
  }

  return deliverToClinicSubscriptions(clinicId, subs, payload, delivery);
}

/** The "nobody is subscribed" terminal path, shared by both clinic-wide senders. */
async function emptyClinicResult(
  clinicId: string,
  payload: PushPayload,
  delivery: PushDeliveryContext | undefined,
): Promise<PushSendResult> {
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

/**
 * Dispatch + expiry cleanup + terminal outbox for an ALREADY-FILTERED list.
 *
 * It takes the subscriptions it should page rather than deciding which to page,
 * which is what keeps the alerts preference out of the emergency path: there is
 * no branch here to forget, because there is no preference here to branch on.
 */
async function deliverToClinicSubscriptions(
  clinicId: string,
  subs: Array<typeof pushSubscriptions.$inferSelect>,
  payload: PushPayload,
  delivery: PushDeliveryContext | undefined,
): Promise<PushSendResult> {
  const expired: ExpiredSubscriptionRef[] = [];
  let deliveredAny = false;
  let transientFailures = 0;
  let invalidOrGoneCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const result = await dispatchToSubscription(sub, buildEnvelopeForSub(sub, payload));
      if (result === "ok") deliveredAny = true;
      if (result === "expired" || result === "invalid") {
        expired.push({ endpoint: sub.endpoint, token: sub.token });
        invalidOrGoneCount += 1;
      }
      if (result === "error") transientFailures += 1;
    }),
  );

  if (expired.length > 0) await cleanupExpiredSubscriptions(clinicId, expired);

  // Was `subs.some((s) => s.alertsEnabled)` when this list was unfiltered;
  // the list arrives filtered now, so its length carries the same meaning.
  const attemptedAny = subs.length > 0;
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
    platform: pushSubscriptions.platform,
    endpoint: pushSubscriptions.endpoint,
    p256dh: pushSubscriptions.p256dh,
    auth: pushSubscriptions.auth,
    token: pushSubscriptions.token,
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

  const expired: ExpiredSubscriptionRef[] = [];
  let transientFailures = 0;
  let invalidOrGoneCount = 0;
  let deliveredRoleCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const result = await dispatchToSubscription(sub, buildEnvelopeForSub(sub, payload));
      if (result === "expired" || result === "invalid") {
        expired.push({ endpoint: sub.endpoint, token: sub.token });
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

  if (expired.length > 0) await cleanupExpiredSubscriptions(clinicId, expired);

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
  if (!vapidReady && !isApnsReady() && !isFcmReady()) {
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

  const expired: ExpiredSubscriptionRef[] = [];
  let deliveredAny = false;
  let transientFailures = 0;
  let invalidOrGoneCount = 0;
  const defer = delivery?.deferTerminalOutbox === true;

  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.alertsEnabled) return;

      const result = await dispatchToSubscription(sub, buildEnvelopeForSub(sub, payload));
      if (result === "ok") deliveredAny = true;
      if (result === "expired" || result === "invalid") {
        expired.push({ endpoint: sub.endpoint, token: sub.token });
        invalidOrGoneCount += 1;
      }
      if (result === "error") transientFailures += 1;
    }),
  );

  if (expired.length > 0) await cleanupExpiredSubscriptions(clinicId, expired);

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
  if (!vapidReady && !isApnsReady() && !isFcmReady()) {
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

  const expired: ExpiredSubscriptionRef[] = [];
  let deliveredCount = 0;
  let transientFailures = 0;
  let invalidOrGoneCount = 0;

  await Promise.all(
    subs.map(async (sub) => {
      const result = await dispatchToSubscription(sub, buildEnvelopeForSub(sub, payload));
      if (result === "ok") deliveredCount += 1;
      if (result === "error") transientFailures += 1;
      if (result === "expired" || result === "invalid") {
        expired.push({ endpoint: sub.endpoint, token: sub.token });
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

  if (expired.length > 0) await cleanupExpiredSubscriptions(clinicId, expired);

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
