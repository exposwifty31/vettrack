import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db, equipment } from "../db.js";
import { sendPushToAll } from "../lib/push.js";
import { incrementMetric } from "../lib/metrics.js";
import { createRedisConnection } from "../lib/redis.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { translate } from "../../lib/i18n/index.js";

export const EXPIRY_CHECK_QUEUE_NAME = "expiry-check";
export const EXPIRY_CHECK_JOB_NAME = "check-expiry";
export const EXPIRY_CHECK_CRON = "0 8 * * *";
export const EXPIRY_CHECK_REPEAT_JOB_ID = "repeat-expiry-check";

type ExpiringEquipmentRow = {
  id: string;
  clinicId: string;
  name: string;
  expiryDate: string;
};

function formatExpiryDate(value: string, locale = "en"): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(locale === "he" ? "he-IL" : "en-US");
}

// sendPushToAll does not carry per-user locale; use the en dict as the
// broadcast default. Hebrew clinics can override by setting a per-clinic
// locale config in a future iteration.
const DEFAULT_PUSH_LOCALE = "en";
function tExpiry(key: string, params?: Record<string, string | number | boolean>): string {
  const dict = loadLocale(DEFAULT_PUSH_LOCALE as "en" | "he");
  return translate(dict, key, params);
}

async function fetchExpiringEquipmentForClinic(clinicId: string): Promise<ExpiringEquipmentRow[]> {
  return db
    .select({
      id: equipment.id,
      clinicId: equipment.clinicId,
      name: equipment.name,
      expiryDate: equipment.expiryDate,
    })
    .from(equipment)
    .where(
      and(
        eq(equipment.clinicId, clinicId),
        isNull(equipment.deletedAt),
        isNull(equipment.expiryNotifiedAt),
        isNotNull(equipment.expiryDate),
        lte(equipment.expiryDate, sql`(CURRENT_DATE + INTERVAL '7 days')::date`),
      ),
    ) as Promise<ExpiringEquipmentRow[]>;
}

async function fetchClinicsWithExpiringEquipment(): Promise<string[]> {
  const rows = await db
    .select({
      clinicId: equipment.clinicId,
    })
    .from(equipment)
    .where(
      and(
        isNull(equipment.deletedAt),
        isNull(equipment.expiryNotifiedAt),
        isNotNull(equipment.expiryDate),
        lte(equipment.expiryDate, sql`(CURRENT_DATE + INTERVAL '7 days')::date`),
      ),
    )
    .groupBy(equipment.clinicId);
  return rows.map((row) => row.clinicId);
}

async function markNotified(clinicId: string, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await db
    .update(equipment)
    .set({ expiryNotifiedAt: new Date() })
    .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt), inArray(equipment.id, itemIds)));
}

export async function runExpiryCheckWorkerForClinic(clinicId: string): Promise<number> {
  const clinicRows = await fetchExpiringEquipmentForClinic(clinicId);
  if (clinicRows.length === 0) {
    if (process.env.NODE_ENV !== "production") console.log("[expiry-check-worker] completed", {
      notifiedCount: 0,
      timestamp: new Date().toISOString(),
    });
    return 0;
  }

  for (const item of clinicRows) {
    await sendPushToAll(clinicId, {
      title: tExpiry("push.expiry.title"),
      body: tExpiry("push.expiry.body", { name: item.name, date: formatExpiryDate(item.expiryDate) }),
      tag: `expiry:${item.id}`,
      url: `/equipment/${item.id}`,
    });
  }
  await markNotified(clinicId, clinicRows.map((row) => row.id));
  const notifiedCount = clinicRows.length;
  if (process.env.NODE_ENV !== "production") console.log("[expiry-check-worker] completed", {
    notifiedCount,
    timestamp: new Date().toISOString(),
  });
  return notifiedCount;
}

export async function runExpiryCheckWorker(): Promise<number> {
  const clinicIds = await fetchClinicsWithExpiringEquipment();
  if (clinicIds.length === 0) {
    if (process.env.NODE_ENV !== "production") console.log("[expiry-check-worker] completed", {
      notifiedCount: 0,
      timestamp: new Date().toISOString(),
    });
    return 0;
  }

  let notifiedCount = 0;
  for (const clinicId of clinicIds) {
    notifiedCount += await runExpiryCheckWorkerForClinic(clinicId);
  }
  return notifiedCount;
}

let expiryCheckQueueInitialized = false;
let expiryCheckQueue: Queue | null = null;
let expiryCheckJobWorker: Worker | null = null;
let legacyWorkerStarterWarned = false;

function warnLegacyWorkerStarterOnce(starterName: string): void {
  if (legacyWorkerStarterWarned) return;
  legacyWorkerStarterWarned = true;
  incrementMetric("legacy_worker_starter_used");
  console.warn("[legacy-worker-starter]", {
    event: "legacy_worker_starter_used",
    starterName,
  });
}

/**
 * @deprecated Use Job Runtime registry execution instead.
 */
export async function startExpiryCheckWorker(): Promise<void> {
  warnLegacyWorkerStarterOnce("startExpiryCheckWorker");
  if (expiryCheckQueueInitialized) return;
  const queueConnection = await createRedisConnection();
  const workerConnection = await createRedisConnection();
  if (!queueConnection || !workerConnection) {
    console.warn("[expiry-check-worker] queue disabled (Redis unavailable)");
    return;
  }

  expiryCheckQueue = new Queue(EXPIRY_CHECK_QUEUE_NAME, { connection: queueConnection });
  expiryCheckJobWorker = new Worker(
    EXPIRY_CHECK_QUEUE_NAME,
    async (job) => {
      if (job.name !== EXPIRY_CHECK_JOB_NAME) return;
      await runExpiryCheckWorker();
    },
    { connection: workerConnection, concurrency: 1 },
  );

  expiryCheckJobWorker.on("failed", (job, error) => {
    console.error("[expiry-check-worker] job failed", {
      jobId: job?.id,
      name: job?.name,
      message: error.message,
    });
  });

  await expiryCheckQueue.add(
    EXPIRY_CHECK_JOB_NAME,
    {},
    {
      jobId: EXPIRY_CHECK_REPEAT_JOB_ID,
      repeat: { pattern: EXPIRY_CHECK_CRON },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  expiryCheckQueueInitialized = true;
  console.log("[expiry-check-worker] scheduled", {
    queueName: EXPIRY_CHECK_QUEUE_NAME,
    cron: EXPIRY_CHECK_CRON,
  });
}
