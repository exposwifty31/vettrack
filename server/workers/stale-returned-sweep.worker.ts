import { randomUUID } from "crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db, equipment, equipmentAnchors, alertAcks } from "../db.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { resolve as resolveI18nKey } from "../../lib/i18n/index.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import type { Locale } from "../../lib/i18n/types.js";
import { logAudit } from "../lib/audit.js";
import { incrementMetric } from "../lib/metrics.js";
import { sendPushToRole, type PushPayload, type PushSendResult } from "../lib/push.js";
import { createRedisConnection } from "../lib/redis.js";

// Returned-but-unverified items sit in the "returned_unverified" reconciliation bucket
// (custodyState === "returned" with no open equipment anchor since return). A returned item
// is typically expected to be re-anchored (docked / citizen-confirmed) well within the same
// shift, so 4h approximates half a shift — late enough to skip same-visit noise, early enough
// to catch items abandoned in transit before shift end.
const STALE_RETURNED_HOURS = Number(process.env.STALE_RETURNED_HOURS) || 4;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly TICK: how often the sweep SCANS — NOT the re-nudge cadence
// D7 — re-nudge cadence gate, mirrors staleCheckoutSweepWorker: compare against the THRESHOLD,
// not the tick, so nudges land at ~4h/8h/12h after return (not 4h/5h/6h).
const RENUDGE_INTERVAL_MS = STALE_RETURNED_HOURS * 3600_000;
const MAX_NUDGES = 3;
const STALE_RETURNED_ALERT_TYPE = "stale_returned_nudge" as const; // fits VARCHAR(30)
// D2 — vt_alert_acks.acknowledgedById AND .acknowledgedByEmail are both NOT NULL with no default.
const SYSTEM_USER_ID = "system:stale-returned";
const SYSTEM_USER_EMAIL = "stale-returned@vettrack.system";
// "Manager" visibility mirrors task-notification.ts: DB roles are admin | vet | technician |
// student (no `manager` role string in schema) — TASK_STARTED/COMPLETED already notify admin +
// vet as the clinic's management tier. Returned items have no holder, so nudge those roles
// instead of a specific user.
const NUDGE_ROLES = ["admin", "vet"] as const;

export const STALE_RETURNED_SWEEP_QUEUE_NAME = "stale-returned-sweep";
export const STALE_RETURNED_SWEEP_JOB_NAME = "sweep-stale-returned";
export const STALE_RETURNED_SWEEP_CRON = "0 * * * *"; // hourly — matches SWEEP_INTERVAL_MS
export const STALE_RETURNED_SWEEP_REPEAT_JOB_ID = "repeat-stale-returned-sweep";

function staleReturnedPushCopyForLocale(locale: Locale): { title: string; body: string } {
  const dict = loadLocale(locale);
  const title = resolveI18nKey(dict, "staleReturned.pushTitle") ?? "Returned equipment needs verification";
  const body =
    resolveI18nKey(dict, "staleReturned.pushBody") ??
    "An item was returned but hasn't been re-verified at its station yet. Please check it in.";
  return { title, body };
}

function mergeDelivery(a: PushSendResult, b: PushSendResult): PushSendResult {
  return {
    deliveredAny: a.deliveredAny || b.deliveredAny,
    transientFailures: a.transientFailures + b.transientFailures,
    invalidOrGoneCount: a.invalidOrGoneCount + b.invalidOrGoneCount,
  };
}

/** Broadcasts to the clinic's manager-tier roles (no single holder exists for a returned item). */
async function nudgeManagers(clinicId: string, payload: PushPayload): Promise<PushSendResult> {
  let result: PushSendResult = { deliveredAny: false, transientFailures: 0, invalidOrGoneCount: 0 };
  for (const role of NUDGE_ROLES) {
    const roleResult = await sendPushToRole(clinicId, role, payload);
    result = mergeDelivery(result, roleResult);
  }
  return result;
}

export async function runStaleReturnedSweep(now = new Date()): Promise<{ scanned: number; nudged: number }> {
  const cutoff = new Date(now.getTime() - STALE_RETURNED_HOURS * 3600_000);
  const candidates = await db.select().from(equipment).where(and(
    eq(equipment.custodyState, "returned"),
    lt(equipment.custodyStateSince, cutoff),
    isNotNull(equipment.custodyStateSince),
    isNotNull(equipment.clinicId),
    isNull(equipment.deletedAt),
  ));

  if (candidates.length === 0) return { scanned: 0, nudged: 0 };

  // Batched anchor lookup (not per-row getCurrentAnchor calls) to avoid N+1: a single query for
  // every candidate id, rather than one round-trip per candidate.
  const candidateIds = candidates.map((row) => row.id);
  const openAnchors = await db
    .select({ equipmentId: equipmentAnchors.equipmentId })
    .from(equipmentAnchors)
    .where(and(
      inArray(equipmentAnchors.equipmentId, candidateIds),
      isNull(equipmentAnchors.invalidatedAt),
    ));
  const anchoredIds = new Set(openAnchors.map((row) => row.equipmentId));

  // Broadcast copy is not resolved per-recipient (unlike staleCheckoutSweepWorker's single
  // holder) — INITIAL_LOCALE is the Phase 6 §19 broadcast default (see role-notification-scheduler.ts).
  const { title, body } = staleReturnedPushCopyForLocale(INITIAL_LOCALE);

  let nudged = 0;
  for (const row of candidates) {
    // Defense-in-depth: this worker only ever nudges genuinely-returned, unverified items —
    // even if the SQL filter above were ever loosened, this guard keeps checked-out equipment
    // (staleCheckoutSweepWorker's job) untouched.
    if (row.custodyState !== "returned") continue;
    if (anchoredIds.has(row.id)) continue; // already re-anchored since return — resolved, not stale

    const clinicId = row.clinicId;                       // non-null per the candidate filter
    const custodyStateSince = row.custodyStateSince!;     // non-null per the candidate filter

    // Phase A — short eligibility transaction (holds advisory lock only while reading acks).
    // Salt 1 (vs staleCheckoutSweepWorker's salt 0) keeps the two workers' advisory-lock
    // namespaces distinct even though custodyState makes their target sets mutually exclusive.
    type Eligibility = { clinicId: string; equipmentId: string };
    const eligibility = await db.transaction(async (tx): Promise<Eligibility | null> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 1))`);
      const prior = await tx.select({ acknowledgedAt: alertAcks.acknowledgedAt })
        .from(alertAcks)
        .where(and(
          eq(alertAcks.clinicId, clinicId),
          eq(alertAcks.equipmentId, row.id),
          eq(alertAcks.alertType, STALE_RETURNED_ALERT_TYPE),
          gt(alertAcks.acknowledgedAt, custodyStateSince),
        ));
      if (prior.length >= MAX_NUDGES) { incrementMetric("stale_returned_skipped"); return null; }
      const lastAt = prior.reduce<Date | null>((m, r) => (!m || r.acknowledgedAt > m ? r.acknowledgedAt : m), null);
      if (lastAt && now.getTime() - lastAt.getTime() < RENUDGE_INTERVAL_MS) {
        incrementMetric("stale_returned_skipped"); return null; // D7 — gate on the threshold
      }
      return { clinicId, equipmentId: row.id };
    });

    if (!eligibility) continue;

    // Phase B — push notification OUTSIDE the transaction to avoid pool exhaustion under lock.
    const pushResult = await nudgeManagers(eligibility.clinicId, {
      title,
      body,
      tag: `stale-returned:${row.id}`,
      url: `/equipment/${row.id}`,
    });
    if (!pushResult.deliveredAny) continue; // no subscriptions / VAPID off → no ack, retried next sweep

    // Phase C — short ack transaction to record the nudge (re-check cap to handle concurrent nudges)
    const didNudge = await db.transaction(async (tx): Promise<boolean> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.id}, 1))`);
      const prior = await tx.select({ acknowledgedAt: alertAcks.acknowledgedAt })
        .from(alertAcks)
        .where(and(
          eq(alertAcks.clinicId, clinicId),
          eq(alertAcks.equipmentId, row.id),
          eq(alertAcks.alertType, STALE_RETURNED_ALERT_TYPE),
          gt(alertAcks.acknowledgedAt, custodyStateSince),
        ));
      if (prior.length >= MAX_NUDGES) return false; // cap hit by concurrent process — acceptable
      await tx.insert(alertAcks).values({          // D2 — every NOT NULL column present
        id: randomUUID(),
        clinicId,
        equipmentId: row.id,
        alertType: STALE_RETURNED_ALERT_TYPE,
        acknowledgedById: SYSTEM_USER_ID,
        acknowledgedByEmail: SYSTEM_USER_EMAIL,
        acknowledgedAt: now,
        ackStatus: "SEEN",
      });
      return true;
    });

    if (didNudge) {
      incrementMetric("stale_returned_nudged");
      logAudit({ clinicId, actionType: "equipment_stale_returned_nudged", performedBy: SYSTEM_USER_ID, performedByEmail: SYSTEM_USER_EMAIL, targetId: row.id, targetType: "equipment", metadata: { custodyState: "returned" } });
      nudged++;
    }
  }
  return { scanned: candidates.length, nudged };
}

export const __test = {
  staleReturnedPushCopyForLocale,
  RENUDGE_INTERVAL_MS,
  MAX_NUDGES,
  STALE_RETURNED_ALERT_TYPE,
  SWEEP_INTERVAL_MS,
};

let sweepQueueInitialized = false;

export function startStaleReturnedSweepWorker(): void {
  if (sweepQueueInitialized) return;
  sweepQueueInitialized = true;

  void (async () => {
    const queueConnection = await createRedisConnection();
    const workerConnection = await createRedisConnection();

    if (!queueConnection || !workerConnection) {
      console.log("[stale-returned-sweep] queue disabled (Redis unavailable) — falling back to setInterval");
      // Fallback for environments without Redis (dev/test without REDIS_URL)
      setInterval(() => {
        runStaleReturnedSweep().catch((e) => console.error("[stale-returned-sweep] failed:", e));
      }, SWEEP_INTERVAL_MS);
      runStaleReturnedSweep().catch((e) => console.error("[stale-returned-sweep] startup failed:", e));
      return;
    }

    const sweepQueue = new Queue(STALE_RETURNED_SWEEP_QUEUE_NAME, { connection: queueConnection });
    const sweepWorker = new Worker(
      STALE_RETURNED_SWEEP_QUEUE_NAME,
      async (job) => {
        if (job.name !== STALE_RETURNED_SWEEP_JOB_NAME) return;
        await runStaleReturnedSweep();
      },
      { connection: workerConnection, concurrency: 1 },
    );

    sweepWorker.on("failed", (job, error) => {
      console.error("[stale-returned-sweep] job failed", {
        jobId: job?.id,
        name: job?.name,
        message: error.message,
      });
    });

    await sweepQueue.add(
      STALE_RETURNED_SWEEP_JOB_NAME,
      {},
      {
        jobId: STALE_RETURNED_SWEEP_REPEAT_JOB_ID,
        repeat: { pattern: STALE_RETURNED_SWEEP_CRON },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );

    console.log("[stale-returned-sweep] scheduled via BullMQ", {
      queueName: STALE_RETURNED_SWEEP_QUEUE_NAME,
      cron: STALE_RETURNED_SWEEP_CRON,
    });

    // Run once at startup so the first sweep doesn't wait up to an hour.
    runStaleReturnedSweep().catch((e) => console.error("[stale-returned-sweep] startup sweep failed:", e));
  })();
}
