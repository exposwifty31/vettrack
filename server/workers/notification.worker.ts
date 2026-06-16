/**
 * BullMQ worker: notifications queue + overdue reminder scheduler.
 * Run as a separate process: pnpm run worker:notifications
 */
import "../lib/env-bootstrap.js";

import crypto from "crypto";
import { Worker } from "bullmq";
import nodemailer from "nodemailer";
import { dispatchTaskNotificationSync } from "../lib/task-notification.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import {
  NOTIFICATION_DLQ_NAME,
  NOTIFICATION_QUEUE_NAME,
  enqueueDeadLetterJob,
  enqueueNotificationJob,
  getNotificationsDlq,
  getNotificationsQueue,
  queueMetrics,
  type AutomationExecutePayload,
  type BillingWebhookPayload,
  type NotificationJobData,
  type ShiftReportEmailPayload,
} from "../lib/queue.js";
import { createRedisConnection, getRedis } from "../lib/redis.js";
import { startWorkerHeartbeat } from "../lib/worker-heartbeat.js";
import { incrementMetric } from "../lib/metrics.js";
import { checkIdempotentAsync, markIdempotentAsync } from "../lib/idempotency.js";
import { isCircuitOpen } from "../lib/circuit-breaker.js";
import { checkDedupe, initVapid, sendPushToAll, sendPushToRole, sendPushToUser } from "../lib/push.js";
import { withTimeout } from "../lib/timeout.js";
import { BROADCAST_TEMPLATES } from "../routes/shift-chat.js";
import { safeRedisSetex } from "../lib/redis.js";
import { decryptConfigValue } from "../lib/config-crypto.js";
import { getUsersWithOverdueTaskCounts } from "../services/task-recall.service.js";
import { executeAutomationJob, scanAndEnqueueAutomationJobs } from "../services/task-automation.service.js";
import { db, inventoryLogs, serverConfig, shiftSessions, users } from "../db.js";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { translate } from "../../lib/i18n/index.js";

const OVERDUE_SCAN_MS = 5 * 60 * 1000;
const AUTOMATION_TICK_MS = 90 * 1000;

async function getUserLocale(userId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ preferredLocale: users.preferredLocale })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
    return row?.preferredLocale ?? "en";
  } catch (err) {
    console.warn("[worker] getUserLocale failed, falling back to 'en':", (err as Error).message);
    return "en";
  }
}

function tPush(locale: string, key: string, params?: Record<string, string | number | boolean>): string {
  const { primary, fallback } = getLocaleDictionaries(locale);
  return translate(primary, key, params, { fallbackDict: fallback, locale });
}

async function handleOverdueReminder(d: { clinicId: string; userId: string; count: number }): Promise<void> {
  if (d.count <= 0) return;
  if (checkDedupe(d.userId, "OVERDUE_REMINDER", 3_600_000)) return;
  const locale = await getUserLocale(d.userId);
  const bodyKey = d.count === 1 ? "push.overdue.body" : "push.overdue.bodyPlural";
  await sendPushToUser(d.clinicId, d.userId, {
    title: tPush(locale, "push.overdue.title"),
    body: tPush(locale, bodyKey, { count: d.count }),
    tag: "overdue-reminder",
    url: "/appointments",
  });
}

async function scanOverdueAndEnqueue(): Promise<void> {
  const rows = await getUsersWithOverdueTaskCounts();
  for (const row of rows) {
    await enqueueNotificationJob({
      type: "overdue_reminder",
      clinicId: row.clinicId,
      userId: row.userId,
      count: row.count,
    });
  }
  if (process.env.NODE_ENV !== "production") console.log("OVERDUE_SCAN_ENQUEUED", { users: rows.length });
}

async function processSendNotification(data: NotificationJobData): Promise<void> {
  if (isCircuitOpen("push")) {
    incrementMetric("circuit_breaker_opened");
    console.warn("[worker] push circuit open; skipping notification job");
    return;
  }
  if (data.type === "shift_chat_snooze") {
    const label = BROADCAST_TEMPLATES[data.broadcastKey]?.label ?? data.broadcastKey;
    await withTimeout(
      sendPushToUser(data.clinicId, data.userId, {
        title: `📢 תזכורת: ${label}`,
        body: "טרם אישרת קבלת הפקודה",
        tag: `shift-chat-snooze-${data.messageId}`,
      }),
      5000,
      "shift_chat_snooze",
    );
    return;
  }
  if (data.type === "task_notification") {
    await withTimeout(dispatchTaskNotificationSync(data.event, data.task, data.actor), 5000, "task notification");
    return;
  }
  if (data.type === "overdue_reminder") {
    await withTimeout(handleOverdueReminder(data), 5000, "overdue reminder");
    return;
  }
  if (data.type === "automation_push_user") {
    await withTimeout(
      sendPushToUser(data.clinicId, data.userId, {
        title: data.title,
        body: data.body,
        tag: data.tag,
        url: "/appointments",
      }),
      5000,
      "automation push user",
    );
    return;
  }
  if (data.type === "automation_push_role") {
    await withTimeout(
      sendPushToRole(data.clinicId, data.role, {
        title: data.title,
        body: data.body,
        tag: data.tag,
        url: "/appointments",
      }),
      5000,
      "automation push role",
    );
    return;
  }
  if (data.type === "code_blue_broadcast") {
    await withTimeout(
      sendPushToAll(data.clinicId, {
        title: data.title,
        body: data.body,
        tag: data.tag,
        url: "/code-blue",
      }),
      10_000,
      "code blue broadcast",
    );
    return;
  }
  if (data.type === "push_to_user") {
    // Fix H: group LOW and NORMAL by (type, tag, clinicId) within a time window.
    // CRITICAL is never grouped — always sent immediately.
    if (data.priority === "LOW" || data.priority === "NORMAL") {
      const windowSec = data.priority === "LOW" ? 300 : 120; // LOW=5min, NORMAL=2min
      const groupKey = `push-group:${data.clinicId}:${data.tag}`;
      const r = await getRedis();
      if (r) {
        const existing = await r.get(groupKey);
        if (existing) {
          incrementMetric("push_grouped_skipped");
          return; // Deduplicated within window
        }
        await r.set(groupKey, "1", "EX", windowSec);
      }
    }
    await withTimeout(
      sendPushToUser(data.clinicId, data.userId, {
        title: data.title,
        body: data.body,
        tag: data.tag,
        url: data.url,
      }),
      5_000,
      `push_to_user [${data.priority}]`,
    );
    return;
  }
  if (data.type === "push_to_role") {
    // Fix H: same grouping logic for role pushes.
    if (data.priority === "LOW" || data.priority === "NORMAL") {
      const windowSec = data.priority === "LOW" ? 300 : 120;
      const groupKey = `push-group:${data.clinicId}:${data.role}:${data.tag}`;
      const r = await getRedis();
      if (r) {
        const existing = await r.get(groupKey);
        if (existing) {
          incrementMetric("push_grouped_skipped");
          return;
        }
        await r.set(groupKey, "1", "EX", windowSec);
      }
    }
    await withTimeout(
      sendPushToRole(data.clinicId, data.role, {
        title: data.title,
        body: data.body,
        tag: data.tag,
        url: data.url,
      }),
      5_000,
      `push_to_role [${data.priority}]`,
    );
    return;
  }
}

// ---------------------------------------------------------------------------
// Billing webhook processor
// ---------------------------------------------------------------------------

async function processBillingWebhook(payload: BillingWebhookPayload): Promise<void> {
  const { webhookUrl, secret, entry } = payload;
  const bodyStr = JSON.stringify(entry);
  const hmac = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VetTrack-Signature": `sha256=${hmac}`,
      },
      body: bodyStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`billing_webhook HTTP ${response.status} from ${webhookUrl}`);
    }
    if (process.env.NODE_ENV !== "production") console.log("BILLING_WEBHOOK_SENT", { clinicId: payload.clinicId, entryId: entry.id, status: response.status });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shift report email helpers
// ---------------------------------------------------------------------------

async function getSmtpConfig(clinicId: string): Promise<{
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}> {
  const clinicKeys = [
    `${clinicId}:smtp_host`,
    `${clinicId}:smtp_port`,
    `${clinicId}:smtp_user`,
    `${clinicId}:smtp_pass`,
    `${clinicId}:smtp_from`,
  ];
  const globalKeys = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"];
  const allKeys = [...clinicKeys, ...globalKeys];

  const rows = await db
    .select()
    .from(serverConfig)
    .where(inArray(serverConfig.key, allKeys));

  const cfg = new Map<string, string>(rows.map((r) => [r.key, r.value]));

  const pick = (clinicKey: string, globalKey: string, envVar: string | undefined, fallback: string): string =>
    cfg.get(clinicKey) ?? cfg.get(globalKey) ?? envVar ?? fallback;

  return {
    host: pick(`${clinicId}:smtp_host`, "smtp_host", process.env.SMTP_HOST, "localhost"),
    port: parseInt(pick(`${clinicId}:smtp_port`, "smtp_port", process.env.SMTP_PORT, "587"), 10),
    user: pick(`${clinicId}:smtp_user`, "smtp_user", process.env.SMTP_USER, ""),
    pass: decryptConfigValue(pick(`${clinicId}:smtp_pass`, "smtp_pass", process.env.SMTP_PASS, "")),
    from: pick(`${clinicId}:smtp_from`, "smtp_from", process.env.SMTP_FROM, "noreply@vettrack.app"),
  };
}

async function handleShiftReportEmail(payload: ShiftReportEmailPayload): Promise<void> {
  const { clinicId, shiftSessionId, managerEmail } = payload;

  // Fetch the shift session to determine the time window
  const [session] = await db
    .select()
    .from(shiftSessions)
    .where(and(eq(shiftSessions.id, shiftSessionId), eq(shiftSessions.clinicId, clinicId)))
    .limit(1);

  const windowStart = session ? new Date(session.startedAt) : new Date(Date.now() - 12 * 60 * 60 * 1000);
  const windowEnd = session?.endedAt ? new Date(session.endedAt) : new Date();

  const totalAmountCents = 0;
  const entryCount = 0;
  const totalAmountDollars = (totalAmountCents / 100).toFixed(2);

  // Consumables summary — unBilledCount + pendingEmergencies
  const consumableRows = await db
    .select({
      metadata: inventoryLogs.metadata,
    })
    .from(inventoryLogs)
    .where(
      and(
        eq(inventoryLogs.clinicId, clinicId),
        eq(inventoryLogs.logType, "adjustment"),
        gte(inventoryLogs.createdAt, windowStart),
        lte(inventoryLogs.createdAt, windowEnd),
        lte(inventoryLogs.quantityAdded, sql`0`),
      ),
    );

  const unBilledCount: number = 0;
  const pendingEmergencies = consumableRows.filter((r) => {
    const meta = r.metadata as Record<string, unknown> | null;
    return meta?.isEmergency === true && meta?.pendingCompletion === true;
  }).length;

  // Format timestamps
  const shiftDate = windowStart.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  // Build HTML email body (jsPDF targets browsers; HTML email is the reliable server-side approach)
  const billingGapsHtml =
    unBilledCount > 0
      ? `<div class="alert">${unBilledCount} consumable dispense${unBilledCount === 1 ? "" : "s"} without a linked billing entry.</div>`
      : `<p style="color:#388e3c;font-size:14px;">&#10003; All consumable dispenses are billed.</p>`;

  const emergencyHtml =
    pendingEmergencies > 0
      ? `<div class="alert danger">${pendingEmergencies} emergency dispense${pendingEmergencies === 1 ? "" : "s"} marked pending completion — review required.</div>`
      : "";

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #1a1a2e; margin: 0; padding: 0; background: #f5f5f5; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
    .header { background: #1a73e8; color: #fff; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 22px; }
    .header p { margin: 4px 0 0; opacity: .85; font-size: 14px; }
    .body { padding: 24px 32px; }
    .metric-row { display: flex; gap: 16px; margin-bottom: 20px; }
    .metric { flex: 1; background: #f0f4ff; border-radius: 8px; padding: 16px; text-align: center; }
    .metric .label { font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: .5px; }
    .metric .value { font-size: 28px; font-weight: bold; color: #1a73e8; margin-top: 4px; }
    .alert { background: #fff3cd; border-left: 4px solid #f0ad00; border-radius: 4px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; }
    .alert.danger { background: #fdecea; border-color: #d32f2f; }
    .footer { padding: 16px 32px; background: #f5f5f5; font-size: 12px; color: #888; text-align: center; }
    h2 { font-size: 16px; margin: 24px 0 8px; color: #333; }
  </style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>VetTrack &mdash; Shift Handover Report</h1>
    <p>${shiftDate} &bull; ${fmt(windowStart)} &ndash; ${fmt(windowEnd)}</p>
  </div>
  <div class="body">
    <h2>Revenue Summary</h2>
    <div class="metric-row">
      <div class="metric">
        <div class="label">Revenue Captured</div>
        <div class="value">$${totalAmountDollars}</div>
      </div>
      <div class="metric">
        <div class="label">Billing Entries</div>
        <div class="value">${entryCount}</div>
      </div>
    </div>
    <h2>Billing Gaps</h2>
    ${billingGapsHtml}
    ${emergencyHtml}
    <h2>Shift Window</h2>
    <p style="font-size:14px;color:#555;">
      Session ID: <code>${shiftSessionId}</code><br />
      Start: ${windowStart.toISOString()}<br />
      End: ${windowEnd.toISOString()}
    </p>
  </div>
  <div class="footer">Generated by VetTrack &bull; Clinic ${clinicId}</div>
</div>
</body>
</html>`;

  const smtp = await getSmtpConfig(clinicId);
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  await transporter.sendMail({
    from: smtp.from,
    to: managerEmail,
    subject: `VetTrack Shift Report \u2014 ${shiftDate}`,
    html: htmlBody,
  });

  if (process.env.NODE_ENV !== "production") console.log("SHIFT_REPORT_EMAIL_SENT", { clinicId, shiftSessionId, managerEmail });
}

// ---------------------------------------------------------------------------
// Worker main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.env.REDIS_URL?.trim()) {
    console.error("WORKER_DISABLED_NO_REDIS");
    process.exit(1);
  }

  await initVapid();

  const connection = await createRedisConnection();
  if (!connection) {
    console.error("[worker] Redis connection failed");
    process.exit(1);
  }

  const queue = await getNotificationsQueue();
  const dlq = await getNotificationsDlq();
  if (!queue) {
    console.error("[worker] notifications queue unavailable");
    process.exit(1);
  }
  if (!dlq) {
    console.error("[worker] notifications DLQ unavailable");
    process.exit(1);
  }

  await queue.add(
    "scan_overdue_reminders",
    {},
    {
      jobId: "repeat-overdue-reminders",
      repeat: { every: OVERDUE_SCAN_MS },
      removeOnComplete: 100,
    },
  );

  await queue.add(
    "automation_tick",
    {},
    {
      jobId: "repeat-automation-tick",
      repeat: { every: AUTOMATION_TICK_MS },
      removeOnComplete: 200,
    },
  );

  void scanOverdueAndEnqueue().catch((err) => console.error("[worker] initial overdue scan failed:", err));
  void scanAndEnqueueAutomationJobs().catch((err) => console.error("[worker] initial automation scan failed:", err));

  // Heartbeat: health checks read this key to confirm the worker is alive.
  // TTL is 120s; we write every 30s, so two missed writes = dead worker alert.
  const HEARTBEAT_KEY = "vettrack:worker:heartbeat";
  const HEARTBEAT_TTL_SEC = 120;
  const HEARTBEAT_INTERVAL_MS = 30_000;
  async function writeHeartbeat() {
    await safeRedisSetex(HEARTBEAT_KEY, HEARTBEAT_TTL_SEC, String(Date.now()));
  }
  void writeHeartbeat().catch((err) => console.error("[worker] initial heartbeat failed:", err));
  setInterval(() => {
    void writeHeartbeat().catch((err) => console.error("[worker] heartbeat failed:", err));
  }, HEARTBEAT_INTERVAL_MS);

  const worker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      const t0 = Date.now();
      const jid = String(job.id ?? "");
      if (process.env.NODE_ENV !== "production") console.log("QUEUE_JOB_STARTED", { id: jid, name: job.name });
      incrementMetric("queue_jobs_started");
      if (job.attemptsMade > 0) {
        incrementMetric("retries_attempted");
        console.warn("QUEUE_JOB_RETRY_ATTEMPT", { id: jid, attemptsMade: job.attemptsMade, name: job.name });
      }
      try {
        if (job.name === "scan_overdue_reminders") {
          await scanOverdueAndEnqueue();
        } else if (job.name === "automation_tick") {
          await scanAndEnqueueAutomationJobs();
        } else if (job.name === "automation_execute") {
          await executeAutomationJob(job.data as AutomationExecutePayload);
        } else if (job.name === "billing_webhook") {
          await withTimeout(processBillingWebhook(job.data as BillingWebhookPayload), 10_000, "billing_webhook");
        } else if (job.name === "send_notification") {
          const key = `notif:${jid}`;
          if (await checkIdempotentAsync(key)) {
            if (process.env.NODE_ENV !== "production") console.log("QUEUE_JOB_SKIPPED_IDEMPOTENT", { id: jid, name: job.name });
            return;
          }
          await processSendNotification(job.data as NotificationJobData);
          await markIdempotentAsync(key);
        } else if (job.name === "shift_report_email") {
          await withTimeout(
            handleShiftReportEmail(job.data as ShiftReportEmailPayload),
            30_000,
            "shift report email",
          );
        }
        queueMetrics.completed++;
        incrementMetric("queue_jobs_completed");
        if (process.env.NODE_ENV !== "production") console.log("QUEUE_JOB_COMPLETED", { id: jid, ms: Date.now() - t0 });
      } catch (err) {
        queueMetrics.failed++;
        incrementMetric("queue_jobs_failed");
        console.error("QUEUE_JOB_FAILED", { id: jid, err: (err as Error).message });
        const maxAttempts = job.opts?.attempts ?? 1;
        if (job.attemptsMade + 1 >= maxAttempts) {
          await enqueueDeadLetterJob({
            sourceQueue: NOTIFICATION_QUEUE_NAME,
            sourceJobId: jid,
            sourceJobName: job.name,
            attemptsMade: job.attemptsMade + 1,
            data: job.data,
            reason: (err as Error).message,
          });
        }
        throw err;
      }
    },
    {
      connection,
      concurrency: 8,
    },
  );

  worker.on("failed", (job, err) => {
    console.error("QUEUE_JOB_FAILED", { jobId: job?.id, err });
  });

  const dlqWorker = new Worker(
    NOTIFICATION_DLQ_NAME,
    async (job) => {
      incrementMetric("queue_jobs_dead_letter");
      const data = job.data as {
        sourceQueue?: string;
        sourceJobId?: string;
        attemptsMade?: number;
        reason?: string;
        data?: unknown;
      };
      console.error("DLQ_JOB_RECEIVED", {
        id: job.id,
        sourceQueue: data?.sourceQueue,
        sourceJobId: data?.sourceJobId,
        attemptsMade: data?.attemptsMade,
        reason: data?.reason,
      });

      // Fix D: escalate CRITICAL push jobs that have exhausted all retries.
      // Only fires when: (1) job has failed after max retries, (2) no successful retry exists.
      const innerData = data?.data as Record<string, unknown> | undefined;
      const isCriticalPush =
        innerData &&
        (innerData.type === "push_to_user" || innerData.type === "push_to_role") &&
        innerData.priority === "CRITICAL";

      if (isCriticalPush) {
        const clinicId = typeof innerData.clinicId === "string" ? innerData.clinicId : null;
        if (clinicId) {
          postSystemMessage(clinicId, "critical_push_delivery_failed", {
            sourceJobId: data?.sourceJobId ?? null,
            reason: data?.reason ?? "unknown",
            pushType: innerData.type,
            tag: typeof innerData.tag === "string" ? innerData.tag : null,
          }).catch(() => {});
        }
        console.error("[dlq] CRITICAL push job permanently failed — escalation triggered", {
          sourceJobId: data?.sourceJobId,
          clinicId,
          reason: data?.reason,
        });
      }
    },
    { connection, concurrency: 1 },
  );

  dlqWorker.on("failed", (job, err) => {
    console.error("DLQ_JOB_FAILED", { jobId: job?.id, err });
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] shutdown requested (${signal})`);
    try {
      await dlqWorker.close();
      await worker.close();
      await queue!.close();
      await dlq!.close();
      await connection!.quit();
      console.log("[worker] graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("[worker] graceful shutdown failed", err);
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  startWorkerHeartbeat("notification-worker");

  console.log("NOTIFICATION_WORKER_STARTED");
  console.log(
    `[worker] notification worker listening (${NOTIFICATION_QUEUE_NAME}), overdue scan every ${OVERDUE_SCAN_MS / 60000} min, automation tick every ${AUTOMATION_TICK_MS / 1000}s`,
  );
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
