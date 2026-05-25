import { Queue, Worker } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { db, equipment, equipmentReturns } from "../db.js";
import { sendPushToAll } from "../lib/push.js";
import { createRedisConnection } from "../lib/redis.js";

export const CHARGE_ALERT_QUEUE_NAME = "charge-alert";
export const CHARGE_ALERT_JOB_NAME = "check-plug";
export const CHARGE_ALERT_JOB_PREFIX = "plug-check-";
export const DEFAULT_PLUG_IN_DEADLINE_MINUTES = 30;
const MAX_PLUG_IN_DEADLINE_MINUTES = 1440;

type ChargeAlertJobPayload = {
  returnId: string;
  equipmentId: string;
  clinicId: string;
};

let chargeAlertQueue: Queue | null = null;
let chargeAlertWorker: Worker | null = null;
let chargeAlertQueueInitialized = false;

/** Binds the producer queue used by {@link enqueueChargeAlertJob} (e.g. job runtime startup). */
export function bindChargeAlertProducerQueue(queue: Queue): void {
  chargeAlertQueue = queue;
  chargeAlertQueueInitialized = true;
}

export function isChargeAlertProducerQueueReady(): boolean {
  return chargeAlertQueue !== null;
}

export function buildChargeAlertJobId(returnId: string): string {
  return `${CHARGE_ALERT_JOB_PREFIX}${returnId}`;
}

function normalizePlugInDeadlineMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLUG_IN_DEADLINE_MINUTES;
  const rounded = Math.floor(value);
  if (rounded < 1) return DEFAULT_PLUG_IN_DEADLINE_MINUTES;
  return Math.min(rounded, MAX_PLUG_IN_DEADLINE_MINUTES);
}

async function getReturnRecord(params: {
  returnId: string;
  clinicId: string;
}): Promise<{
  id: string;
  clinicId: string;
  equipmentId: string;
  isPluggedIn: boolean;
  plugInDeadlineMinutes: number;
  plugInAlertSentAt: Date | null;
} | null> {
  const [row] = await db
    .select({
      id: equipmentReturns.id,
      clinicId: equipmentReturns.clinicId,
      equipmentId: equipmentReturns.equipmentId,
      isPluggedIn: equipmentReturns.isPluggedIn,
      plugInDeadlineMinutes: equipmentReturns.plugInDeadlineMinutes,
      plugInAlertSentAt: equipmentReturns.plugInAlertSentAt,
    })
    .from(equipmentReturns)
    .where(
      and(
        eq(equipmentReturns.id, params.returnId),
        eq(equipmentReturns.clinicId, params.clinicId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getEquipmentName(clinicId: string, equipmentId: string): Promise<string> {
  const [row] = await db
    .select({ name: equipment.name })
    .from(equipment)
    .where(
      and(
        eq(equipment.clinicId, clinicId),
        eq(equipment.id, equipmentId),
        isNull(equipment.deletedAt),
      ),
    )
    .limit(1);
  return row?.name ?? "Equipment";
}

async function markChargeAlertSent(returnId: string, clinicId: string): Promise<void> {
  await db
    .update(equipmentReturns)
    .set({ plugInAlertSentAt: new Date() })
    .where(
      and(
        eq(equipmentReturns.id, returnId),
        eq(equipmentReturns.clinicId, clinicId),
      ),
    );
}

export async function processChargeAlertJob(
  payload: ChargeAlertJobPayload,
): Promise<"skipped" | "alerted"> {
  const returnRecord = await getReturnRecord({
    returnId: payload.returnId,
    clinicId: payload.clinicId,
  });
  if (!returnRecord) {
    return "skipped";
  }
  if (returnRecord.isPluggedIn) {
    return "skipped";
  }
  if (returnRecord.plugInAlertSentAt) {
    return "skipped";
  }

  const equipmentName = await getEquipmentName(payload.clinicId, payload.equipmentId);
  await sendPushToAll(payload.clinicId, {
    title: "🔋 ציוד לא מחובר לחשמל",
    body: `${equipmentName} לא חובר לחשמל תוך ${returnRecord.plugInDeadlineMinutes} דקות`,
    tag: `charge-alert:${returnRecord.id}`,
    url: `/equipment/${payload.equipmentId}`,
  });
  await markChargeAlertSent(returnRecord.id, payload.clinicId);

  if (process.env.NODE_ENV !== "production") console.log("[charge-alert-worker] alerted", {
    returnId: returnRecord.id,
    equipmentId: payload.equipmentId,
    clinicId: payload.clinicId,
    timestamp: new Date().toISOString(),
  });
  return "alerted";
}

export async function enqueueChargeAlertJob(params: {
  returnId: string;
  equipmentId: string;
  clinicId: string;
  plugInDeadlineMinutes: number;
}): Promise<string | null> {
  const jobId = buildChargeAlertJobId(params.returnId);
  if (!chargeAlertQueue) {
    return jobId;
  }
  await chargeAlertQueue.add(
    CHARGE_ALERT_JOB_NAME,
    {
      returnId: params.returnId,
      equipmentId: params.equipmentId,
      clinicId: params.clinicId,
    } satisfies ChargeAlertJobPayload,
    {
      delay: normalizePlugInDeadlineMinutes(params.plugInDeadlineMinutes) * 60 * 1000,
      jobId,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  return jobId;
}

export async function cancelChargeAlertJob(returnId: string): Promise<void> {
  if (!chargeAlertQueue) {
    return;
  }
  const job = await chargeAlertQueue.getJob(buildChargeAlertJobId(returnId));
  if (!job) return;
  await job.remove();
}

export async function runChargeAlertJobForReturn(
  returnId: string,
  clinicId: string,
): Promise<{ notified: boolean }> {
  const record = await getReturnRecord({ returnId, clinicId });
  if (!record) {
    throw new Error("RETURN_NOT_FOUND");
  }
  const outcome = await processChargeAlertJob({
    returnId: record.id,
    equipmentId: record.equipmentId,
    clinicId: record.clinicId,
  });
  return { notified: outcome === "alerted" };
}

export async function startChargeAlertWorker(): Promise<void> {
  if (chargeAlertQueueInitialized) return;
  const queueConnection = await createRedisConnection();
  const workerConnection = await createRedisConnection();
  if (!queueConnection || !workerConnection) {
    console.warn("[charge-alert-worker] queue disabled (Redis unavailable)");
    return;
  }

  bindChargeAlertProducerQueue(new Queue(CHARGE_ALERT_QUEUE_NAME, { connection: queueConnection }));
  chargeAlertWorker = new Worker(
    CHARGE_ALERT_QUEUE_NAME,
    async (job) => {
      if (job.name !== CHARGE_ALERT_JOB_NAME) return;
      await processChargeAlertJob(job.data as ChargeAlertJobPayload);
    },
    { connection: workerConnection, concurrency: 1 },
  );

  chargeAlertWorker.on("failed", (job, error) => {
    console.error("[charge-alert-worker] job failed", {
      jobId: job?.id,
      name: job?.name,
      message: error.message,
    });
  });

  console.log("[charge-alert-worker] started", {
    queueName: CHARGE_ALERT_QUEUE_NAME,
    jobName: CHARGE_ALERT_JOB_NAME,
  });
}
