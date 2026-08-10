/**
 * FCM transport (Android + Expo native tokens) — ADR-009 §1.
 *
 * Uses firebase-admin (the Capacitor-documented Android push path). Credentials
 * are read from the environment (loaded by env-bootstrap; never hardcoded). When
 * absent the transport degrades gracefully — logging once and reporting
 * not-ready so the dispatcher skips Android/Expo sends without crashing. The
 * OWNER supplies the real service-account JSON later.
 *
 * ADR-009 §2: payload is an ALERT only (title/body + opaque referenceId in
 * `data`). G4-0b (open owner decision): the Android notification channel id and
 * message priority are PARAMETERIZED via env (FCM_ANDROID_CHANNEL_ID /
 * FCM_ANDROID_PRIORITY) — no final "urgent" channel value is baked here, because
 * Android channels are immutable after first creation.
 *
 * Note (Expo): a bare-workflow / dev-client RN app registers a native FCM device
 * token, which this path handles. If the RN client instead uses Expo's push
 * service (ExponentPushToken via exp.host), that needs a separate Expo transport
 * — a G4-3 client decision, flagged, not built here.
 */
import type { PushAlertEnvelope } from "@vettrack/contracts";
import type { PushDispatchOutcome } from "./push-types.js";

interface FcmConfig {
  serviceAccount: Record<string, unknown>;
  androidChannelId: string | undefined;
  androidPriority: "high" | "normal";
}

let fcmMessaging: import("firebase-admin/messaging").Messaging | null = null;
let fcmConfig: FcmConfig | null = null;
let fcmInitAttempted = false;

const FCM_APP_NAME = "vettrack-fcm";

function readFcmConfig(): FcmConfig | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON ?? "";
  if (!raw) return null;
  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.error("❌ FCM_SERVICE_ACCOUNT_JSON is not valid JSON — Android/Expo push disabled");
    return null;
  }
  const priority = process.env.FCM_ANDROID_PRIORITY === "normal" ? "normal" : "high";
  return {
    serviceAccount,
    androidChannelId: process.env.FCM_ANDROID_CHANNEL_ID || undefined,
    androidPriority: priority,
  };
}

export function isFcmReady(): boolean {
  return fcmMessaging !== null;
}

/** Lazy, idempotent. Safe to call at startup and before each send. */
export async function initFcm(): Promise<void> {
  if (fcmMessaging || fcmInitAttempted) return;
  fcmInitAttempted = true;

  const config = readFcmConfig();
  if (!config) {
    console.warn("⚠️  FCM not configured (FCM_SERVICE_ACCOUNT_JSON) — Android/Expo push disabled");
    return;
  }

  try {
    const { initializeApp, cert, getApps, getApp } = await import("firebase-admin/app");
    const { getMessaging } = await import("firebase-admin/messaging");
    const existing = getApps().find((a) => a.name === FCM_APP_NAME);
    const app = existing
      ? getApp(FCM_APP_NAME)
      : initializeApp({ credential: cert(config.serviceAccount as Parameters<typeof cert>[0]) }, FCM_APP_NAME);
    fcmMessaging = getMessaging(app);
    fcmConfig = config;
    console.log("✅ FCM initialized (service account)");
  } catch (err) {
    console.error("❌ FCM init failed:", err instanceof Error ? err.message : err);
    fcmMessaging = null;
  }
}

function classifyFcmError(code: string | undefined): PushDispatchOutcome {
  if (code === "messaging/registration-token-not-registered") return "expired";
  if (
    code === "messaging/invalid-registration-token" ||
    code === "messaging/invalid-argument" ||
    code === "messaging/mismatched-credential"
  ) {
    return "invalid";
  }
  return "error";
}

/**
 * Send one alert to an Android/Expo FCM registration token. Returns the same
 * outcome vocabulary as the web-push path so aggregation stays uniform.
 */
export async function sendFcmPush(token: string, payload: PushAlertEnvelope): Promise<PushDispatchOutcome> {
  if (!fcmMessaging) {
    await initFcm();
    if (!fcmMessaging || !fcmConfig) return "skipped";
  }
  const config = fcmConfig!;

  try {
    await fcmMessaging.send({
      token,
      notification: { title: payload.title, body: payload.body },
      android: {
        priority: config.androidPriority,
        notification: {
          ...(config.androidChannelId ? { channelId: config.androidChannelId } : {}),
        },
      },
      // Opaque reference only (ADR-009 §2). FCM data values must be strings.
      ...(payload.referenceId ? { data: { referenceId: payload.referenceId } } : {}),
    });
    return "ok";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code && code !== "messaging/internal-error") {
      console.error("[push-fcm] send failed:", code);
    } else {
      console.error("[push-fcm] send failed:", err instanceof Error ? err.message : err);
    }
    return classifyFcmError(code);
  }
}
