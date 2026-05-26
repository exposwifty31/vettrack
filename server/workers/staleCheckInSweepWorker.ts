// Phase 2.5 PR 5.2 — Stale Check-In Sweeper (Shadow-Only).
//
// Read-only periodic scan that classifies open clinicalCheckIns rows into age
// buckets and emits structured telemetry. SHADOW MODE: no writes, no
// authority changes, no enforcement. Disabled by default; activate by
// setting STALE_CHECKIN_SWEEP_ENABLED=true.
import { isNull } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { db, clinicalCheckIns } from "../db.js";
import { incrementMetric } from "../lib/metrics.js";
import { createRedisConnection } from "../lib/redis.js";
import { createLogLimiter, type LogLimiter } from "../lib/log-safety.js";

export const STALE_CHECKIN_SWEEP_QUEUE_NAME = "stale-checkin-sweep";
export const STALE_CHECKIN_SWEEP_JOB_NAME = "sweep-stale-checkins";
export const STALE_CHECKIN_SWEEP_CRON = "17 */6 * * *";
export const STALE_CHECKIN_SWEEP_REPEAT_JOB_ID = "repeat-stale-checkin-sweep";

const FRESH_THRESHOLD_HOURS = 24;
const STALE_THRESHOLD_HOURS = 36;
const HARD_STALE_THRESHOLD_HOURS = 72;
const SAMPLE_CAP = 20;
const ID_LOG_PREFIX_LEN = 8;
const PER_CLINIC_LOG_DEDUPE_MS = 6 * 60 * 60 * 1000;

export type StaleBucket = "fresh" | "soft_stale" | "stale" | "hard_stale";

interface OpenCheckInRow {
  id: string;
  clinicId: string;
  checkedInAt: Date;
}

export interface ClinicAggregate {
  clinicId: string;
  totalOpen: number;
  fresh: number;
  softStale: number;
  stale: number;
  hardStale: number;
  oldestCheckInAgeHours: number;
}

export interface SweepResult {
  durationMs: number;
  clinicsScanned: number;
  totalOpen: number;
  totalFresh: number;
  totalSoftStale: number;
  totalStale: number;
  totalHardStale: number;
  recurringStaleCount: number;
  sampledStaleIds: string[];
  perClinic: ClinicAggregate[];
}

export function classifyBucket(ageHrs: number): StaleBucket {
  if (ageHrs < FRESH_THRESHOLD_HOURS) return "fresh";
  if (ageHrs < STALE_THRESHOLD_HOURS) return "soft_stale";
  if (ageHrs < HARD_STALE_THRESHOLD_HOURS) return "stale";
  return "hard_stale";
}

function ageHours(nowMs: number, checkedInAt: Date): number {
  return (nowMs - checkedInAt.getTime()) / (60 * 60 * 1000);
}

export function isStaleCheckInSweepEnabled(): boolean {
  return process.env.STALE_CHECKIN_SWEEP_ENABLED === "true";
}

// Process-scoped state (intentional — not persisted; survives until restart).
let previousStaleIds: Set<string> = new Set();
let perClinicLogLimiter: LogLimiter = createLogLimiter({
  dedupeWindowMs: PER_CLINIC_LOG_DEDUPE_MS,
  maxEntries: 2000,
});

async function fetchOpenCheckIns(): Promise<OpenCheckInRow[]> {
  return db
    .select({
      id: clinicalCheckIns.id,
      clinicId: clinicalCheckIns.clinicId,
      checkedInAt: clinicalCheckIns.checkedInAt,
    })
    .from(clinicalCheckIns)
    .where(isNull(clinicalCheckIns.checkedOutAt)) as Promise<OpenCheckInRow[]>;
}

export async function runStaleCheckInSweep(now: Date = new Date()): Promise<SweepResult> {
  const startedAt = Date.now();
  const nowMs = now.getTime();
  const rows = await fetchOpenCheckIns();

  const perClinic = new Map<string, ClinicAggregate>();
  const currentStaleIds = new Set<string>();
  const staleSample: { id: string; checkedInAt: Date }[] = [];

  let totalFresh = 0;
  let totalSoftStale = 0;
  let totalStale = 0;
  let totalHardStale = 0;

  for (const row of rows) {
    const ageHrs = ageHours(nowMs, row.checkedInAt);
    const bucket = classifyBucket(ageHrs);

    let agg = perClinic.get(row.clinicId);
    if (!agg) {
      agg = {
        clinicId: row.clinicId,
        totalOpen: 0,
        fresh: 0,
        softStale: 0,
        stale: 0,
        hardStale: 0,
        oldestCheckInAgeHours: 0,
      };
      perClinic.set(row.clinicId, agg);
    }
    agg.totalOpen += 1;
    if (ageHrs > agg.oldestCheckInAgeHours) agg.oldestCheckInAgeHours = ageHrs;

    if (bucket === "fresh") {
      agg.fresh += 1;
      totalFresh += 1;
    } else if (bucket === "soft_stale") {
      agg.softStale += 1;
      totalSoftStale += 1;
    } else if (bucket === "stale") {
      agg.stale += 1;
      totalStale += 1;
      currentStaleIds.add(row.id);
      staleSample.push({ id: row.id, checkedInAt: row.checkedInAt });
    } else {
      agg.hardStale += 1;
      totalHardStale += 1;
      currentStaleIds.add(row.id);
      staleSample.push({ id: row.id, checkedInAt: row.checkedInAt });
    }
  }

  for (const agg of perClinic.values()) {
    if (agg.stale + agg.hardStale === 0) continue;
    if (perClinicLogLimiter.shouldLog(`stale-clinic:${agg.clinicId}`)) {
      console.warn("[stale-checkin-sweep] clinic has stale check-ins", {
        clinicId: agg.clinicId,
        totalOpen: agg.totalOpen,
        softStale: agg.softStale,
        stale: agg.stale,
        hardStale: agg.hardStale,
        oldestCheckInAgeHours: Math.round(agg.oldestCheckInAgeHours * 10) / 10,
        timestamp: new Date(nowMs).toISOString(),
      });
    }
  }

  let recurringStaleCount = 0;
  for (const id of currentStaleIds) {
    if (previousStaleIds.has(id)) recurringStaleCount += 1;
  }
  previousStaleIds = currentStaleIds;

  staleSample.sort((a, b) => a.checkedInAt.getTime() - b.checkedInAt.getTime());
  const sampledStaleIds = staleSample
    .slice(0, SAMPLE_CAP)
    .map((r) => r.id.slice(0, ID_LOG_PREFIX_LEN));

  const durationMs = Date.now() - startedAt;
  const limiterSnapshot = perClinicLogLimiter.getSnapshot();

  const result: SweepResult = {
    durationMs,
    clinicsScanned: perClinic.size,
    totalOpen: rows.length,
    totalFresh,
    totalSoftStale,
    totalStale,
    totalHardStale,
    recurringStaleCount,
    sampledStaleIds,
    perClinic: Array.from(perClinic.values()),
  };

  console.log("[stale-checkin-sweep] scan complete", {
    durationMs: result.durationMs,
    clinicsScanned: result.clinicsScanned,
    totalOpen: result.totalOpen,
    totalFresh: result.totalFresh,
    totalSoftStale: result.totalSoftStale,
    totalStale: result.totalStale,
    totalHardStale: result.totalHardStale,
    recurringStaleCount: result.recurringStaleCount,
    sampledStaleIds: result.sampledStaleIds,
    logLimiterSnapshot: limiterSnapshot,
    timestamp: new Date(nowMs).toISOString(),
  });

  return result;
}

let sweepQueueInitialized = false;
let sweepQueue: Queue | null = null;
let sweepWorker: Worker | null = null;
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
export async function startStaleCheckInSweepWorker(): Promise<void> {
  warnLegacyWorkerStarterOnce("startStaleCheckInSweepWorker");
  if (sweepQueueInitialized) return;

  if (!isStaleCheckInSweepEnabled()) {
    console.log(
      "[stale-checkin-sweep] disabled by STALE_CHECKIN_SWEEP_ENABLED flag",
    );
    return;
  }

  const queueConnection = await createRedisConnection();
  const workerConnection = await createRedisConnection();
  if (!queueConnection || !workerConnection) {
    console.warn("[stale-checkin-sweep] queue disabled (Redis unavailable)");
    return;
  }

  sweepQueue = new Queue(STALE_CHECKIN_SWEEP_QUEUE_NAME, {
    connection: queueConnection,
  });
  sweepWorker = new Worker(
    STALE_CHECKIN_SWEEP_QUEUE_NAME,
    async (job) => {
      if (job.name !== STALE_CHECKIN_SWEEP_JOB_NAME) return;
      await runStaleCheckInSweep();
    },
    { connection: workerConnection, concurrency: 1 },
  );

  sweepWorker.on("failed", (job, error) => {
    console.error("[stale-checkin-sweep] job failed", {
      jobId: job?.id,
      name: job?.name,
      message: error.message,
    });
  });

  await sweepQueue.add(
    STALE_CHECKIN_SWEEP_JOB_NAME,
    {},
    {
      jobId: STALE_CHECKIN_SWEEP_REPEAT_JOB_ID,
      repeat: { pattern: STALE_CHECKIN_SWEEP_CRON },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  sweepQueueInitialized = true;
  console.log("[stale-checkin-sweep] scheduled", {
    queueName: STALE_CHECKIN_SWEEP_QUEUE_NAME,
    cron: STALE_CHECKIN_SWEEP_CRON,
  });
}

export function __resetSweepStateForTests(): void {
  previousStaleIds = new Set();
  perClinicLogLimiter = createLogLimiter({
    dedupeWindowMs: PER_CLINIC_LOG_DEDUPE_MS,
    maxEntries: 2000,
  });
  sweepQueueInitialized = false;
  sweepQueue = null;
  sweepWorker = null;
}

export const __test = {
  FRESH_THRESHOLD_HOURS,
  STALE_THRESHOLD_HOURS,
  HARD_STALE_THRESHOLD_HOURS,
  SAMPLE_CAP,
  STALE_CHECKIN_SWEEP_QUEUE_NAME,
  STALE_CHECKIN_SWEEP_JOB_NAME,
  STALE_CHECKIN_SWEEP_CRON,
  STALE_CHECKIN_SWEEP_REPEAT_JOB_ID,
};
