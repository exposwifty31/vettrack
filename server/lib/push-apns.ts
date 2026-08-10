/**
 * APNs transport (iOS) — ADR-009 §1/§3.
 *
 * Token-based auth (.p8 key + keyId + teamId) over HTTP/2 via @parse/node-apn.
 * Credentials are read from the environment (loaded by env-bootstrap; never
 * hardcoded). When they are absent the transport degrades gracefully — like the
 * Redis-optional queues — logging once and reporting not-ready so the dispatcher
 * skips iOS sends without crashing. The OWNER supplies the real .p8/keyId/teamId
 * later; this code is ready for them.
 *
 * ADR-009 §2: the payload is an ALERT only (title/body + opaque referenceId). No
 * authoritative state. ADR-009 §3: interruption level is parameterized and
 * defaults to `time-sensitive`; `critical` is entitlement-gated (owner tail) and
 * must be set via APNS_INTERRUPTION_LEVEL only once Apple grants Critical Alerts.
 */
import type { PushAlertEnvelope } from "@vettrack/contracts";
import type { PushDispatchOutcome } from "./push-types.js";

interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  production: boolean;
  interruptionLevel: string;
  criticalSound: boolean;
}

// Loosely typed handles — the concrete @parse/node-apn types are resolved lazily.
type ApnsProvider = { send: (notification: unknown, token: string) => Promise<ApnsSendResult>; shutdown: () => void };
interface ApnsSendResult {
  sent: Array<{ device: string }>;
  failed: Array<{ device: string; status?: string | number; response?: { reason?: string } }>;
}

let apnsProvider: ApnsProvider | null = null;
let apnsConfig: ApnsConfig | null = null;
let apnsInitAttempted = false;

function readApnsConfig(): ApnsConfig | null {
  const keyRaw = process.env.APNS_KEY_P8 ?? "";
  const keyId = process.env.APNS_KEY_ID ?? "";
  const teamId = process.env.APNS_TEAM_ID ?? "";
  const bundleId = process.env.APNS_BUNDLE_ID ?? "";
  if (!keyRaw || !keyId || !teamId || !bundleId) return null;

  return {
    // Env stores the PEM with escaped newlines; restore them for node-apn.
    keyP8: keyRaw.includes("\\n") ? keyRaw.replace(/\\n/g, "\n") : keyRaw,
    keyId,
    teamId,
    bundleId,
    production: (process.env.APNS_PRODUCTION ?? (process.env.NODE_ENV === "production" ? "true" : "false")) === "true",
    // Default to the honest fallback; `critical` is gated on the Apple entitlement (owner tail).
    interruptionLevel: process.env.APNS_INTERRUPTION_LEVEL ?? "time-sensitive",
    criticalSound: process.env.APNS_INTERRUPTION_LEVEL === "critical",
  };
}

/** True once a provider is built from present credentials. */
export function isApnsReady(): boolean {
  return apnsProvider !== null;
}

/** Lazy, idempotent. Safe to call at startup and before each send. */
export async function initApns(): Promise<void> {
  if (apnsProvider || apnsInitAttempted) return;
  apnsInitAttempted = true;

  const config = readApnsConfig();
  if (!config) {
    console.warn("⚠️  APNs not configured (APNS_KEY_P8/APNS_KEY_ID/APNS_TEAM_ID/APNS_BUNDLE_ID) — iOS push disabled");
    return;
  }

  try {
    const mod = (await import("@parse/node-apn")) as unknown as { default?: unknown };
    const apn = (mod.default ?? mod) as {
      Provider: new (opts: unknown) => ApnsProvider;
    };
    apnsProvider = new apn.Provider({
      token: { key: config.keyP8, keyId: config.keyId, teamId: config.teamId },
      production: config.production,
    });
    apnsConfig = config;
    console.log("✅ APNs initialized (token auth)");
  } catch (err) {
    console.error("❌ APNs init failed:", err instanceof Error ? err.message : err);
    apnsProvider = null;
  }
}

function classifyApnsFailure(status: string | number | undefined, reason: string | undefined): PushDispatchOutcome {
  const code = typeof status === "string" ? parseInt(status, 10) : status;
  if (code === 410) return "expired"; // Unregistered — token no longer valid
  if (code === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")) return "invalid";
  return "error"; // 403 auth, 429/500/503 transient, etc.
}

/**
 * Send one alert to an iOS device token. Returns the same outcome vocabulary as
 * the web-push path so the caller's aggregation stays uniform.
 */
export async function sendApnsPush(token: string, payload: PushAlertEnvelope): Promise<PushDispatchOutcome> {
  if (!apnsProvider) {
    await initApns();
    if (!apnsProvider || !apnsConfig) return "skipped";
  }
  const config = apnsConfig!;

  try {
    const mod = (await import("@parse/node-apn")) as unknown as { default?: unknown };
    const apn = (mod.default ?? mod) as { Notification: new () => Record<string, unknown> };
    const note = new apn.Notification();
    note.topic = config.bundleId;
    note.pushType = "alert";
    note.priority = 10;
    note.alert = { title: payload.title, body: payload.body };
    note.interruptionLevel = config.interruptionLevel;
    note.sound = config.criticalSound
      ? { critical: 1, name: "default", volume: 1 }
      : "default";
    // Opaque reference only (ADR-009 §2) — NOT authoritative state.
    if (payload.referenceId) note.payload = { referenceId: payload.referenceId };

    const result = await apnsProvider.send(note, token);
    if (result.sent.length > 0) return "ok";
    const failure = result.failed[0];
    return classifyApnsFailure(failure?.status, failure?.response?.reason);
  } catch (err) {
    console.error("[push-apns] send failed:", err instanceof Error ? err.message : err);
    return "error";
  }
}
