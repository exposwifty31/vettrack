import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { incrementMetric } from "../lib/metrics.js";
import { withJobLatency } from "../lib/job-latency.js";
import { createRedisConnection } from "../lib/redis.js";
import { startWorkerHeartbeat, stopWorkerHeartbeat } from "../lib/worker-heartbeat.js";
import { processChargeAlertJob, bindChargeAlertProducerQueue } from "../workers/chargeAlertWorker.js";
import {
  runExpiryCheckWorker,
  EXPIRY_CHECK_CRON,
  EXPIRY_CHECK_REPEAT_JOB_ID,
} from "../workers/expiryCheckWorker.js";
import {
  runStaleCheckInSweep,
  isStaleCheckInSweepEnabled,
  STALE_CHECKIN_SWEEP_CRON,
  STALE_CHECKIN_SWEEP_REPEAT_JOB_ID,
} from "../workers/staleCheckInSweepWorker.js";
import {
  type ChargeAlertJobPayload,
  definitionsByQueue,
  EXPIRY_CHECK_JOB_NAME,
  EXPIRY_CHECK_QUEUE_NAME,
  getStaticJobDefinition,
  isPilotQueueName,
  PILOT_QUEUE_NAMES,
  resolveDefinitionForJobName,
  STALE_CHECKIN_SWEEP_JOB_NAME,
  STALE_CHECKIN_SWEEP_QUEUE_NAME,
} from "./definitions/index.js";
import { CHARGE_ALERT_QUEUE_NAME } from "../workers/chargeAlertWorker.js";
import { getOrCreateQueue } from "./queue-factory.js";
import { mergeEnqueueJobOptions, type JobContext } from "./registry.js";
type RuntimeWorkerEntry = {
  queueName: string;
  worker: Worker;
  connection: Redis;
};

import {
  getRuntimeReadiness,
  resetJobRuntimeReadinessForTests,
  setJobRuntimeReadinessState,
} from "./runtime-readiness.js";

const runtimeWorkers: RuntimeWorkerEntry[] = [];
const repeatJobsRegistered = new Set<string>();

function workerFailedLogTag(queueName: string): string {
  if (queueName === CHARGE_ALERT_QUEUE_NAME) return "charge-alert-worker";
  if (queueName === EXPIRY_CHECK_QUEUE_NAME) return "expiry-check-worker";
  if (queueName === STALE_CHECKIN_SWEEP_QUEUE_NAME) return "stale-checkin-sweep";
  return "job-runtime";
}

function buildJobContext(job: Job): JobContext {
  const data = job.data as { clinicId?: string } | undefined;
  return {
    clinicId: typeof data?.clinicId === "string" ? data.clinicId : undefined,
    jobId: job.id ?? "unknown",
    attempt: job.attemptsMade + 1,
  };
}

async function runPilotJob(queueName: string, job: Job): Promise<void> {
  const definition = resolveDefinitionForJobName(queueName, job.name);
  if (!definition) {
    incrementMetric("job_runtime_unknown_job_name");
    console.warn("[job-runtime]", {
      event: "job_runtime_unknown_job_name",
      queueName,
      jobName: job.name,
    });
    throw new Error(
      `No JobDefinition for queue=${queueName} job.name=${job.name}`,
    );
  }

  // Time the whole dispatch (success or failure) under the job's bounded kind —
  // surfaced via getMetricsSnapshot().jobLatency, no new route.
  return withJobLatency(definition.kind, async () => {
    const ctx = buildJobContext(job);

    if (queueName === CHARGE_ALERT_QUEUE_NAME) {
      await processChargeAlertJob(job.data as ChargeAlertJobPayload);
      return;
    }

    if (queueName === EXPIRY_CHECK_QUEUE_NAME) {
      await runExpiryCheckWorker();
      return;
    }

    if (queueName === STALE_CHECKIN_SWEEP_QUEUE_NAME) {
      await runStaleCheckInSweep();
      return;
    }

    if (definition.handler) {
      await definition.handler(job.data, ctx);
      return;
    }

    throw new Error(
      `No pilot handler wired for queue=${queueName} job.name=${job.name}`,
    );
  });
}

async function ensureQueueCronRepeatJob(
  queueName: string,
  jobName: string,
  jobId: string,
  cron: string,
): Promise<void> {
  if (repeatJobsRegistered.has(queueName)) return;

  const definition = definitionsByQueue.get(queueName)?.[0];
  if (!definition) return;

  try {
    const queue = await getOrCreateQueue({
      queueName,
      defaultJobOptions: mergeEnqueueJobOptions(definition),
      logLabel: `${queueName}-queue`,
    });
    await queue.add(
      jobName,
      {},
      {
        jobId,
        repeat: { pattern: cron },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );
    repeatJobsRegistered.add(queueName);
    console.log("[job-runtime] repeat job scheduled", {
      queueName,
      jobName,
      cron,
    });
  } catch (err) {
    console.warn("[job-runtime] repeat job unavailable", {
      queueName,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function ensureChargeAlertProducerQueue(): Promise<void> {
  const definition = getStaticJobDefinition("check-plug");
  const queue = await getOrCreateQueue({
    queueName: CHARGE_ALERT_QUEUE_NAME,
    defaultJobOptions: mergeEnqueueJobOptions(definition),
    logLabel: "charge-alert-queue",
  });
  bindChargeAlertProducerQueue(queue);
}

async function startPilotWorker(
  queueName: string,
): Promise<{ name: string; ok: boolean }> {
  const defs = definitionsByQueue.get(queueName);
  if (!defs || defs.length === 0) {
    console.warn("[job-runtime]", {
      event: "job_runtime_worker_unavailable",
      queueName,
      reason: "NO_DEFINITIONS",
    });
    incrementMetric("job_runtime_worker_unavailable");
    return { name: queueName, ok: false };
  }

  const connection = await createRedisConnection();
  if (!connection) {
    console.warn("[job-runtime]", {
      event: "job_runtime_worker_unavailable",
      queueName,
      reason: "REDIS_UNAVAILABLE",
    });
    incrementMetric("job_runtime_worker_unavailable");
    return { name: queueName, ok: false };
  }

  const concurrency = defs[0]?.workerConcurrency ?? 1;

  const worker = new Worker(
    queueName,
    async (job) => {
      await runPilotJob(queueName, job);
    },
    { connection, concurrency },
  );

  worker.on("failed", (job, error) => {
    console.error(`[${workerFailedLogTag(queueName)}] job failed`, {
      jobId: job?.id,
      name: job?.name,
      message: error.message,
    });

    if (!job) return;
    const maxAttempts = job.opts?.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      incrementMetric("queue_jobs_dead_letter");
      getOrCreateQueue({
        queueName: "pilot-dlq",
        logLabel: "pilot-dlq",
      })
        .then((dlq) =>
          dlq.add("dead-letter", {
            sourceQueue: queueName,
            jobId: job.id,
            jobName: job.name,
            failedReason: error.message,
            attemptsMade: job.attemptsMade,
            failedAt: new Date().toISOString(),
          }, { removeOnComplete: false, removeOnFail: false }),
        )
        .catch((dlqErr) => {
          console.error("[job-runtime] pilot-dlq enqueue failed", {
            sourceQueue: queueName,
            jobId: job.id,
            message: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
          });
        });
    }
  });

  runtimeWorkers.push({ queueName, worker, connection });

  console.log("[job-runtime] worker started", {
    queueName,
    concurrency,
    jobKinds: defs.map((d) => d.kind),
  });

  return { name: queueName, ok: true };
}

/**
 * Starts BullMQ workers for Phase 1b pilot queues only.
 * Redis unavailable → warn and return (does not throw).
 */
export async function startJobRuntime(): Promise<void> {
  if (getRuntimeReadiness().started) return;

  try {
    await ensureChargeAlertProducerQueue();
  } catch (err) {
    console.warn("[job-runtime] charge-alert producer queue unavailable", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const results: Array<{ name: string; ok: boolean }> = [];
  for (const queueName of PILOT_QUEUE_NAMES) {
    if (!isPilotQueueName(queueName)) continue;

    if (queueName === STALE_CHECKIN_SWEEP_QUEUE_NAME && !isStaleCheckInSweepEnabled()) {
      console.log(
        "[job-runtime] stale-checkin-sweep skipped (STALE_CHECKIN_SWEEP_ENABLED flag)",
      );
      results.push({ name: queueName, ok: true });
      continue;
    }

    const workerResult = await startPilotWorker(queueName);
    results.push(workerResult);

    if (workerResult.ok) {
      if (queueName === EXPIRY_CHECK_QUEUE_NAME) {
        await ensureQueueCronRepeatJob(
          EXPIRY_CHECK_QUEUE_NAME,
          EXPIRY_CHECK_JOB_NAME,
          EXPIRY_CHECK_REPEAT_JOB_ID,
          EXPIRY_CHECK_CRON,
        );
      } else if (queueName === STALE_CHECKIN_SWEEP_QUEUE_NAME) {
        await ensureQueueCronRepeatJob(
          STALE_CHECKIN_SWEEP_QUEUE_NAME,
          STALE_CHECKIN_SWEEP_JOB_NAME,
          STALE_CHECKIN_SWEEP_REPEAT_JOB_ID,
          STALE_CHECKIN_SWEEP_CRON,
        );
      }
    }
  }

  const allWorkersOk = results.every((r) => r.ok);
  setJobRuntimeReadinessState({
    started: allWorkersOk,
    workers: results,
  });

  // Only publish /api/health heartbeat when every pilot worker started (Codex P2: partial
  // startup must not mask a failed queue consumer).
  if (allWorkersOk && runtimeWorkers.length > 0) {
    startWorkerHeartbeat("job-runtime");
  }

  console.log("[job-runtime] pilot runtime active", {
    queues: PILOT_QUEUE_NAMES,
    workers: runtimeWorkers.map((e) => e.queueName),
  });
}

export async function closeJobRuntime(): Promise<void> {
  stopWorkerHeartbeat();
  for (const entry of runtimeWorkers) {
    try {
      await entry.worker.close();
    } catch (err) {
      console.error("[job-runtime] worker close failed", {
        queueName: entry.queueName,
        message: err instanceof Error ? err.message : err,
      });
    }
    try {
      await entry.connection.quit();
    } catch {
      /* best-effort */
    }
  }
  runtimeWorkers.length = 0;
  resetJobRuntimeReadinessForTests();
}

export function isJobRuntimeStarted(): boolean {
  return getRuntimeReadiness().started;
}

export { getRuntimeReadiness } from "./runtime-readiness.js";

/** Test-only: reset runtime singleton state without closing Redis. */
export function resetJobRuntimeStateForTests(): void {
  runtimeWorkers.length = 0;
  repeatJobsRegistered.clear();
  resetJobRuntimeReadinessForTests();
}
