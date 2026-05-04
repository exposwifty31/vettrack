import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { clinics, db } from "../db.js";
import { evaluateOutboxHealthForClinic, type OutboxHealthEvaluation } from "../lib/outbox-health.js";
import { getMetricsSnapshot } from "../lib/metrics.js";
import { getRedis } from "../lib/redis.js";

const INTERVAL_MS =
  Number.parseInt(process.env.SYSTEM_HEALTH_MONITOR_INTERVAL_MS ?? `${5 * 60_000}`, 10) || 5 * 60_000;

/** Warning tier when realtime publish lag exceeds this (ms). */
export const PUBLISH_LAG_MS_WARNING =
  Number.parseInt(process.env.SYSTEM_HEALTH_PUBLISH_LAG_MS_WARNING ?? "2000", 10) || 2000;

/** Critical tier when publish lag exceeds this (ms). */
export const PUBLISH_LAG_MS_CRITICAL =
  Number.parseInt(process.env.SYSTEM_HEALTH_PUBLISH_LAG_MS_CRITICAL ?? "5000", 10) || 5000;

/** Min cumulative `outbox_failed_publish_attempts` increase since last tick to treat as a spike. */
export const FAILED_PUBLISH_DELTA_CRITICAL =
  Number.parseInt(process.env.SYSTEM_HEALTH_FAILED_PUBLISH_DELTA_CRITICAL ?? "10", 10) || 10;

/** Min `gap_resync_count` increase since last tick to emit INFO (inclusive). */
export const GAP_RESYNC_DELTA_INFO =
  Number.parseInt(process.env.SYSTEM_HEALTH_GAP_RESYNC_DELTA_INFO ?? "1", 10) || 1;

/** Min increase to emit WARNING instead of INFO for gap resync spikes. */
export const GAP_RESYNC_DELTA_WARNING =
  Number.parseInt(process.env.SYSTEM_HEALTH_GAP_RESYNC_DELTA_WARNING ?? "5", 10) || 5;

/** Skip duplicate CRITICAL webhook posts for the same fingerprint within this window (ms). */
const WEBHOOK_DEDUPE_MS =
  Number.parseInt(process.env.SYSTEM_HEALTH_WEBHOOK_DEDUPE_MS ?? `${15 * 60_000}`, 10) || 15 * 60_000;

const LEGACY_SLACK_URL =
  process.env.SYSTEM_ALERT_SLACK_WEBHOOK_URL?.trim() || process.env.SLACK_WEBHOOK_URL?.trim() || "";
const LEGACY_DISCORD_URL =
  process.env.SYSTEM_ALERT_DISCORD_WEBHOOK_URL?.trim() || process.env.DISCORD_WEBHOOK_URL?.trim() || "";

export type SystemHealthSeverityTier = "INFO" | "WARNING" | "CRITICAL";

export type SystemHealthReasonCode =
  | "DEAD_LETTER"
  | "PUBLISH_LAG"
  | "FAILED_PUBLISH_SPIKE"
  | "GAP_RESYNC_SPIKE";

export interface SystemHealthReason {
  code: SystemHealthReasonCode;
  severity: SystemHealthSeverityTier;
  detail: string;
  /** Metric key that breached (for routing / paging context). */
  breachedMetric?: string;
}

export interface SystemHealthAlertPayload {
  severity: SystemHealthSeverityTier;
  source: "system_health_monitor";
  ts: string;
  clinic?: string;
  evaluation?: OutboxHealthEvaluation;
  reasons: SystemHealthReason[];
  failed_publish_delta?: number;
  gap_resync_delta?: number;
  /** Absolute URL to Ops Dashboard (omitted if base URL is not configured). */
  opsDashboardUrl?: string;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;
let tickInFlight = false;
let lastTickErrorLogAt = 0;

let lastFailedPublishAttempts: number | null = null;
let lastGapResyncCount: number | null = null;

const criticalWebhookDedupeMemory = new Map<string, number>();

function pruneCriticalDedupeMemory(now: number): void {
  for (const [k, t] of criticalWebhookDedupeMemory) {
    if (now - t > WEBHOOK_DEDUPE_MS) criticalWebhookDedupeMemory.delete(k);
  }
}

function shouldSendCriticalWebhookMemory(fingerprint: string, now: number): boolean {
  pruneCriticalDedupeMemory(now);
  const prev = criticalWebhookDedupeMemory.get(fingerprint);
  if (prev !== undefined && now - prev < WEBHOOK_DEDUPE_MS) return false;
  criticalWebhookDedupeMemory.set(fingerprint, now);
  return true;
}

/**
 * Returns true if this CRITICAL notification should be sent to urgent webhooks (not deduped in Redis/memory).
 */
async function shouldSendCriticalWebhookNow(fingerprint: string, now: number): Promise<boolean> {
  const ttlSec = Math.max(1, Math.floor(WEBHOOK_DEDUPE_MS / 1000));
  const hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 48);
  const key = `vettrack:sh_crit:${hash}`;
  const redis = await getRedis();
  if (redis) {
    try {
      const res = await redis.set(key, "1", "EX", ttlSec, "NX");
      if (res === "OK") return true;
      return false;
    } catch (err) {
      console.warn("[system-health-monitor] Redis CRITICAL dedupe failed; using memory fallback", {
        message: (err as Error).message,
      });
    }
  }
  return shouldSendCriticalWebhookMemory(fingerprint, now);
}

function maxSeverity(reasons: SystemHealthReason[]): SystemHealthSeverityTier {
  if (reasons.some((r) => r.severity === "CRITICAL")) return "CRITICAL";
  if (reasons.some((r) => r.severity === "WARNING")) return "WARNING";
  return "INFO";
}

function resolveAppBaseUrl(): string {
  const explicit =
    process.env.SYSTEM_HEALTH_APP_BASE_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const allowed = process.env.ALLOWED_ORIGIN?.trim();
  if (allowed) {
    const first = allowed.split(",")[0]?.trim();
    if (first) return first.replace(/\/$/, "");
  }
  return "";
}

function resolveOpsDashboardUrl(): string | undefined {
  const base = resolveAppBaseUrl();
  if (!base) return undefined;
  return `${base}/admin/ops-dashboard`;
}

function isDiscordWebhook(url: string): boolean {
  return /discord\.com\/api\/webhooks/i.test(url) || /discordapp\.com\/api\/webhooks/i.test(url);
}

async function postWebhook(url: string, text: string): Promise<void> {
  if (!url) return;
  const trimmed = text.length > 1900 ? `${text.slice(0, 1897)}...` : text;
  const body = isDiscordWebhook(url)
    ? JSON.stringify({ content: trimmed })
    : JSON.stringify({ text: trimmed });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("[system-health-monitor] webhook failed", url.slice(0, 48), res.status);
  }
}

async function postLegacySlack(text: string): Promise<void> {
  return postWebhook(LEGACY_SLACK_URL, text);
}

async function postLegacyDiscord(text: string): Promise<void> {
  return postWebhook(LEGACY_DISCORD_URL, text);
}

async function appendPersistentAlertLog(payload: SystemHealthAlertPayload): Promise<void> {
  const logPath =
    process.env.SYSTEM_HEALTH_ALERT_LOG_PATH?.trim() ||
    path.join(process.cwd(), "logs", "system-health-alerts.log");
  const line = JSON.stringify({ channel: "SYSTEM_ALERT", ...payload });
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${line}\n`, "utf8");
  } catch (err) {
    console.error("[system-health-monitor] persistent alert log failed", {
      logPath,
      message: (err as Error).message,
    });
  }
}

export function logSystemAlert(payload: SystemHealthAlertPayload): void {
  const line = JSON.stringify({ channel: "SYSTEM_ALERT", ...payload });
  if (payload.severity === "INFO") {
    console.log(`[SYSTEM_ALERT] ${line}`);
  } else if (payload.severity === "WARNING") {
    console.warn(`[SYSTEM_ALERT] ${line}`);
  } else {
    console.error(`[SYSTEM_ALERT] ${line}`);
  }
}

function formatStandardSummary(payload: SystemHealthAlertPayload): string {
  const parts = payload.reasons.map((r) => `[${r.severity}] ${r.code}: ${r.detail}`);
  const clinic = payload.clinic ? `clinic=${payload.clinic}` : "global";
  return [`*VetTrack system health* (${payload.severity})`, clinic, ...parts].join("\n");
}

function formatCriticalSummary(payload: SystemHealthAlertPayload): string {
  const clinicLine = payload.clinic ? `*clinic ID:* \`${payload.clinic}\`` : "*scope:* global";
  const dash = payload.opsDashboardUrl
    ? `*Ops Dashboard:* ${payload.opsDashboardUrl}`
    : "*Ops Dashboard:* (set SYSTEM_HEALTH_APP_BASE_URL or PUBLIC_APP_URL)";
  const reasonLines = payload.reasons.map((r) => {
    const m = r.breachedMetric ? ` — metric: \`${r.breachedMetric}\`` : "";
    return `• *${r.code}*${m}\n  ${r.detail}`;
  });
  return [`🚨 *VetTrack CRITICAL — System Health*`, clinicLine, dash, "", ...reasonLines].join("\n");
}

async function dispatchAlert(payload: SystemHealthAlertPayload): Promise<void> {
  const enriched: SystemHealthAlertPayload = {
    ...payload,
    opsDashboardUrl: payload.opsDashboardUrl ?? resolveOpsDashboardUrl(),
  };

  logSystemAlert(enriched);
  await appendPersistentAlertLog(enriched);

  if (enriched.severity === "INFO" || enriched.severity === "WARNING") {
    const standardUrl = process.env.SYSTEM_ALERT_STANDARD_WEBHOOK_URL?.trim();
    if (standardUrl) {
      await postWebhook(standardUrl, formatStandardSummary(enriched));
    }
    return;
  }

  const fingerprint = `${enriched.clinic ?? "global"}:${enriched.reasons.map((r) => r.code).sort().join(",")}`;
  const now = Date.now();
  if (!(await shouldSendCriticalWebhookNow(fingerprint, now))) {
    return;
  }

  const summary = formatCriticalSummary(enriched);
  const criticalUrl = process.env.SYSTEM_ALERT_CRITICAL_WEBHOOK_URL?.trim();
  if (criticalUrl) {
    await postWebhook(criticalUrl, summary);
  } else {
    await Promise.allSettled([postLegacySlack(summary), postLegacyDiscord(summary)]);
  }
}

/**
 * Per-clinic outbox / lag evaluation with strict severity tiers.
 * @see PUBLISH_LAG_MS_WARNING — lag &gt; this → WARNING
 * @see PUBLISH_LAG_MS_CRITICAL — lag &gt; this → CRITICAL
 */
export function evaluateClinicHealthReasons(ev: OutboxHealthEvaluation): SystemHealthReason[] {
  const reasons: SystemHealthReason[] = [];
  if (ev.dead_letter_count > 0) {
    reasons.push({
      code: "DEAD_LETTER",
      severity: "CRITICAL",
      detail: `dead_letter_count=${ev.dead_letter_count} (pipeline rows stuck after retries)`,
      breachedMetric: "dead_letter_count",
    });
  }
  const lag = ev.publish_lag_ms;
  if (lag !== null) {
    if (lag > PUBLISH_LAG_MS_CRITICAL) {
      reasons.push({
        code: "PUBLISH_LAG",
        severity: "CRITICAL",
        detail: `publish_lag_ms=${lag} (critical threshold ${PUBLISH_LAG_MS_CRITICAL}ms)`,
        breachedMetric: "publish_lag_ms",
      });
    } else if (lag > PUBLISH_LAG_MS_WARNING) {
      reasons.push({
        code: "PUBLISH_LAG",
        severity: "WARNING",
        detail: `publish_lag_ms=${lag} (warning > ${PUBLISH_LAG_MS_WARNING}ms, critical if > ${PUBLISH_LAG_MS_CRITICAL}ms)`,
        breachedMetric: "publish_lag_ms",
      });
    }
  }
  return reasons;
}

/**
 * @deprecated Use {@link evaluateClinicHealthReasons}. Kept for tests: returns only CRITICAL-tier reasons (legacy shape).
 */
export function evaluateClinicCritical(ev: OutboxHealthEvaluation): Pick<SystemHealthReason, "code" | "detail">[] {
  return evaluateClinicHealthReasons(ev)
    .filter((r) => r.severity === "CRITICAL")
    .map(({ code, detail }) => ({ code, detail }));
}

export async function runSystemHealthMonitorTick(): Promise<void> {
  const clinicRows = await db.select({ id: clinics.id }).from(clinics);
  const ts = new Date().toISOString();
  const snap = getMetricsSnapshot().realtime;
  const currentFailed = snap.outboxFailedPublishAttempts;
  const currentGap = snap.gapResyncs;
  const opsDashboardUrl = resolveOpsDashboardUrl();

  for (const row of clinicRows) {
    const clinicId = row.id?.trim();
    if (!clinicId) continue;

    const ev = await evaluateOutboxHealthForClinic(clinicId);
    const clinicReasons = evaluateClinicHealthReasons(ev);
    if (clinicReasons.length === 0) continue;

    await dispatchAlert({
      severity: maxSeverity(clinicReasons),
      source: "system_health_monitor",
      ts,
      clinic: clinicId,
      evaluation: ev,
      reasons: clinicReasons,
      opsDashboardUrl,
    });
  }

  if (lastFailedPublishAttempts !== null) {
    const delta = Math.max(0, currentFailed - lastFailedPublishAttempts);
    if (delta >= FAILED_PUBLISH_DELTA_CRITICAL) {
      const reasons: SystemHealthReason[] = [
        {
          code: "FAILED_PUBLISH_SPIKE",
          severity: "CRITICAL",
          detail: `outbox_failed_publish_attempts increased by ${delta} in the last monitoring window (threshold ${FAILED_PUBLISH_DELTA_CRITICAL})`,
          breachedMetric: "outbox_failed_publish_attempts",
        },
      ];
      await dispatchAlert({
        severity: "CRITICAL",
        source: "system_health_monitor",
        ts,
        reasons,
        failed_publish_delta: delta,
        opsDashboardUrl,
      });
    }
  }

  if (lastGapResyncCount !== null) {
    const gapDelta = Math.max(0, currentGap - lastGapResyncCount);
    if (gapDelta >= GAP_RESYNC_DELTA_WARNING) {
      const reasons: SystemHealthReason[] = [
        {
          code: "GAP_RESYNC_SPIKE",
          severity: "WARNING",
          detail: `gap_resync_count increased by ${gapDelta} in the last monitoring window (warning threshold ${GAP_RESYNC_DELTA_WARNING})`,
          breachedMetric: "gap_resync_count",
        },
      ];
      await dispatchAlert({
        severity: "WARNING",
        source: "system_health_monitor",
        ts,
        reasons,
        gap_resync_delta: gapDelta,
        opsDashboardUrl,
      });
    } else if (gapDelta >= GAP_RESYNC_DELTA_INFO) {
      const reasons: SystemHealthReason[] = [
        {
          code: "GAP_RESYNC_SPIKE",
          severity: "INFO",
          detail: `gap_resync_count increased by ${gapDelta} in the last monitoring window (info threshold ${GAP_RESYNC_DELTA_INFO})`,
          breachedMetric: "gap_resync_count",
        },
      ];
      await dispatchAlert({
        severity: "INFO",
        source: "system_health_monitor",
        ts,
        reasons,
        gap_resync_delta: gapDelta,
        opsDashboardUrl,
      });
    }
  }

  lastFailedPublishAttempts = currentFailed;
  lastGapResyncCount = currentGap;
}

export function startSystemHealthMonitor(): void {
  if (started) return;
  started = true;
  void runSystemHealthMonitorTick().catch((err) => {
    console.error("[system-health-monitor] initial tick failed", err);
  });
  intervalHandle = setInterval(() => {
    if (tickInFlight) return;
    tickInFlight = true;
    void runSystemHealthMonitorTick().catch((err) => {
      const now = Date.now();
      if (now - lastTickErrorLogAt > 30_000) {
        lastTickErrorLogAt = now;
        console.error("[system-health-monitor] tick failed", err);
      }
    }).finally(() => {
      tickInFlight = false;
    });
  }, INTERVAL_MS);
}

export function stopSystemHealthMonitorForTests(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
  tickInFlight = false;
  lastTickErrorLogAt = 0;
  lastFailedPublishAttempts = null;
  lastGapResyncCount = null;
  criticalWebhookDedupeMemory.clear();
}
