import { randomUUID } from "crypto";
import { and, eq, gt, lt, isNotNull, isNull, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db, equipment, alertAcks } from "../db.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { resolve as resolveI18nKey } from "../../lib/i18n/index.js";
import type { Locale } from "../../lib/i18n/types.js";
import { resolveUserLocale } from "../lib/resolve-user-locale.js";
import { logAudit } from "../lib/audit.js";
import { incrementMetric } from "../lib/metrics.js";
import { sendPushToUser } from "../lib/push.js";
import { createRedisConnection } from "../lib/redis.js";

const STALE_CHECKOUT_HOURS = Number(process.env.STALE_CHECKOUT_HOURS) || 12;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly TICK: how often the sweep SCANS — NOT the re-nudge cadence
// D7 — re-nudge cadence gate. Must compare against the THRESHOLD, not the tick, so nudges land at
// ~12h/24h/36h after checkout (E1), not 12h/13h/14h. (If STALE_CHECKOUT_HOURS < 1 the gate is
// tighter than the tick, so the hourly scan naturally bounds re-nudges to once per tick — still ≤ 3.)
const RENUDGE_INTERVAL_MS = STALE_CHECKOUT_HOURS * 3600_000;
const MAX_NUDGES = 3;
const STALE_CHECKOUT_ALERT_TYPE = "stale_checkout_nudge" as const; // fits VARCHAR(30)
// D2 — vt_alert_acks.acknowledgedById AND .acknowledgedByEmail are both NOT NULL with no default.
const SYSTEM_USER_ID = "system:stale-checkout";
const SYSTEM_USER_EMAIL = "stale-checkout@vettrack.system"; // mirrors semi-dock's SYSTEM_USER_EMAIL

export const STALE_CHECKOUT_SWEEP_QUEUE_NAME = "stale-checkout-sweep";
export const STALE_CHECKOUT_SWEEP_JOB_NAME = "sweep-stale-checkouts";
export const STALE_CHECKOUT_SWEEP_CRON = "0 * * * *"; // hourly — matches SWEEP_INTERVAL_MS
export const STALE_CHECKOUT_SWEEP_REPEAT_JOB_ID = "repeat-stale-checkout-sweep";

function staleCheckoutPushCopyForLocale(locale: Locale): { title: string; body: string } {
  const dict = loadLocale(locale);
  const title = resolveI18nKey(dict, "staleCheckout.pushTitle") ?? "Equipment still checked out";
  const body =
    resolveI18nKey(dict, "staleCheckout.pushBody") ??
    "This device has been checked out a while. If you're done, please return it.";
  return { title, body };
}

async function resolveStaleCheckoutPushCopy(
  clinicId: string,
  holderUserId: string,
): Promise<{ title: string; body: string }> {
  const locale = await resolveUserLocale(clinicId, holderUserId);
  return staleCheckoutPushCopyForLocale(locale);
}

export async function runStaleCheckoutSweep(now = new Date()): Promise<{ scanned: number; nudged: number }> {
  const cutoff = new Date(now.getTime() - STALE_CHECKOUT_HOURS * 3600_000);
  const candidates = await db.select().from(equipment).where(and(
    eq(equipment.custodyState, "checked_out"),
    lt(equipment.checkedOutAt, cutoff),
    isNotNull(equipment.checkedOutById),
    isNotNull(equipment.clinicId),
    isNull(equipment.deletedAt),
  ));
  let nudged = 0;
  for (const row of candidates) {
    const holderId = row.checkedOutById!;
    const clinicId = row.clinicId;            // non-null per the candidate filter
    const checkedOutAt = row.checkedOutAt!;   // non-null when custodyState === "checked_out"
    const { title, body } = await resolveStaleCheckoutPushCopy(clinicId, holderId);

    // Phase A — short eligibility transaction (holds advisory lock only while reading acks)
    type Eligibility = { clinicId: string; holderId: string; equipmentId: string; title: string; body: string };
    const eligibility = await db.transaction(async (tx): Promise<Eligibility | null> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 0))`);
      const prior = await tx.select({ acknowledgedAt: alertAcks.acknowledgedAt })
        .from(alertAcks)
        .where(and(
          eq(alertAcks.clinicId, clinicId),
          eq(alertAcks.equipmentId, row.id),
          eq(alertAcks.alertType, STALE_CHECKOUT_ALERT_TYPE),
          gt(alertAcks.acknowledgedAt, checkedOutAt),
        ));
      if (prior.length >= MAX_NUDGES) { incrementMetric("stale_checkout_skipped"); return null; }
      const lastAt = prior.reduce<Date | null>((m, r) => (!m || r.acknowledgedAt > m ? r.acknowledgedAt : m), null);
      if (lastAt && now.getTime() - lastAt.getTime() < RENUDGE_INTERVAL_MS) {
        incrementMetric("stale_checkout_skipped"); return null; // D7 — gate on the threshold
      }
      return { clinicId, holderId, equipmentId: row.id, title, body };
    });

    if (!eligibility) continue;

    // Phase B — push notification OUTSIDE the transaction to avoid pool exhaustion under lock
    const pushResult = await sendPushToUser(
      eligibility.clinicId,
      eligibility.holderId,
      { title: eligibility.title, body: eligibility.body, tag: `stale-checkout:${row.id}`, url: `/equipment/${row.id}` },
    );
    if (!pushResult.deliveredAny) continue; // no subscription / VAPID off → no ack, retried next sweep

    // Phase C — short ack transaction to record the nudge (re-check cap to handle concurrent nudges)
    const didNudge = await db.transaction(async (tx): Promise<boolean> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 0))`);
      const prior = await tx.select({ acknowledgedAt: alertAcks.acknowledgedAt })
        .from(alertAcks)
        .where(and(
          eq(alertAcks.clinicId, clinicId),
          eq(alertAcks.equipmentId, row.id),
          eq(alertAcks.alertType, STALE_CHECKOUT_ALERT_TYPE),
          gt(alertAcks.acknowledgedAt, checkedOutAt),
        ));
      if (prior.length >= MAX_NUDGES) return false; // cap hit by concurrent process — acceptable
      await tx.insert(alertAcks).values({          // D2 — every NOT NULL column present
        id: randomUUID(),
        clinicId,
        equipmentId: row.id,
        alertType: STALE_CHECKOUT_ALERT_TYPE,
        acknowledgedById: SYSTEM_USER_ID,
        acknowledgedByEmail: SYSTEM_USER_EMAIL,
        acknowledgedAt: now,
        ackStatus: "SEEN",
      });
      return true;
    });

    if (didNudge) {
      incrementMetric("stale_checkout_nudged");
      logAudit({ clinicId, actionType: "equipment_stale_checkout_nudged", performedBy: SYSTEM_USER_ID, performedByEmail: SYSTEM_USER_EMAIL, targetId: row.id, targetType: "equipment", metadata: { checkedOutById: holderId } });
      nudged++;
    }
  }
  return { scanned: candidates.length, nudged };
}

export const __test = {
  staleCheckoutPushCopyForLocale,
  resolveStaleCheckoutPushCopy,
  RENUDGE_INTERVAL_MS,
  MAX_NUDGES,
  STALE_CHECKOUT_ALERT_TYPE,
  SWEEP_INTERVAL_MS,
};

let sweepQueueInitialized = false;

export function startStaleCheckoutSweepWorker(): void {
  if (sweepQueueInitialized) return;
  sweepQueueInitialized = true;

  void (async () => {
    const queueConnection = await createRedisConnection();
    const workerConnection = await createRedisConnection();

    if (!queueConnection || !workerConnection) {
      console.log("[stale-checkout-sweep] queue disabled (Redis unavailable) — falling back to setInterval");
      // Fallback for environments without Redis (dev/test without REDIS_URL)
      setInterval(() => {
        runStaleCheckoutSweep().catch((e) => console.error("[stale-checkout-sweep] failed:", e));
      }, SWEEP_INTERVAL_MS);
      runStaleCheckoutSweep().catch((e) => console.error("[stale-checkout-sweep] startup failed:", e));
      return;
    }

    const sweepQueue = new Queue(STALE_CHECKOUT_SWEEP_QUEUE_NAME, { connection: queueConnection });
    const sweepWorker = new Worker(
      STALE_CHECKOUT_SWEEP_QUEUE_NAME,
      async (job) => {
        if (job.name !== STALE_CHECKOUT_SWEEP_JOB_NAME) return;
        await runStaleCheckoutSweep();
      },
      { connection: workerConnection, concurrency: 1 },
    );

    sweepWorker.on("failed", (job, error) => {
      console.error("[stale-checkout-sweep] job failed", {
        jobId: job?.id,
        name: job?.name,
        message: error.message,
      });
    });

    await sweepQueue.add(
      STALE_CHECKOUT_SWEEP_JOB_NAME,
      {},
      {
        jobId: STALE_CHECKOUT_SWEEP_REPEAT_JOB_ID,
        repeat: { pattern: STALE_CHECKOUT_SWEEP_CRON },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );

    console.log("[stale-checkout-sweep] scheduled via BullMQ", {
      queueName: STALE_CHECKOUT_SWEEP_QUEUE_NAME,
      cron: STALE_CHECKOUT_SWEEP_CRON,
    });

    // Run once at startup so the first sweep doesn't wait up to an hour.
    runStaleCheckoutSweep().catch((e) => console.error("[stale-checkout-sweep] startup sweep failed:", e));
  })();
}
