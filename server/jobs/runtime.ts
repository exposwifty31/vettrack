import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { createRedisConnection } from "../lib/redis.js";
import { processChargeAlertJob, bindChargeAlertProducerQueue } from "../workers/chargeAlertWorker.js";
import { processInventoryDeductionJob } from "../workers/inventory-deduction.worker.js";
import {
  type ChargeAlertJobPayload,
  definitionsByQueue,
  getStaticJobDefinition,
  isPilotQueueName,
  PILOT_QUEUE_NAMES,
  resolveDefinitionForJobName,
} from "./definitions/index.js";
import { INVENTORY_DEDUCTION_QUEUE_NAME } from "../queues/inventory-deduction.queue.js";
import { CHARGE_ALERT_QUEUE_NAME } from "../workers/chargeAlertWorker.js";
import { getOrCreateQueue } from "./queue-factory.js";
import { mergeEnqueueJobOptions, type JobContext } from "./registry.js";
import type { InventoryDeductionJobData } from "../queues/inventory-deduction.queue.js";

type RuntimeWorkerEntry = {
  queueName: string;
  worker: Worker;
  connection: Redis;
};

let runtimeStarted = false;
const runtimeWorkers: RuntimeWorkerEntry[] = [];
let workerStartupResults: Array<{ name: string; ok: boolean }> = [];

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
    console.warn("[job-runtime] job_runtime_unknown_job_name", {
      event: "job_runtime_unknown_job_name",
      queueName,
      jobName: job.name,
    });
    throw new Error(
      `No JobDefinition for queue=${queueName} job.name=${job.name}`,
    );
  }

  const ctx = buildJobContext(job);

  if (queueName === INVENTORY_DEDUCTION_QUEUE_NAME) {
    await processInventoryDeductionJob(job.data as InventoryDeductionJobData);
    return;
  }

  if (queueName === CHARGE_ALERT_QUEUE_NAME) {
    await processChargeAlertJob(job.data as ChargeAlertJobPayload);
    return;
  }

  if (definition.handler) {
    await definition.handler(job.data, ctx);
    return;
  }

  throw new Error(
    `No pilot handler wired for queue=${queueName} job.name=${job.name}`,
  );
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
    console.warn("[job-runtime] no definitions for queue", { queueName });
    return { name: queueName, ok: false };
  }

  const connection = await createRedisConnection();
  if (!connection) {
    console.warn(`[job-runtime] ${queueName} worker disabled (Redis unavailable)`);
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
    const logTag =
      queueName === INVENTORY_DEDUCTION_QUEUE_NAME
        ? "inventory-deduction"
        : queueName === CHARGE_ALERT_QUEUE_NAME
          ? "charge-alert-worker"
          : "job-runtime";
    console.error(`[${logTag}] job failed`, {
      jobId: job?.id,
      name: job?.name,
      message: error.message,
    });
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
  if (runtimeStarted) return;

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
    results.push(await startPilotWorker(queueName));
  }

  workerStartupResults = results;
  runtimeStarted = results.every((r) => r.ok);
  console.log("[job-runtime] pilot runtime active", {
    queues: PILOT_QUEUE_NAMES,
    workers: runtimeWorkers.map((e) => e.queueName),
  });
}

export async function closeJobRuntime(): Promise<void> {
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
  runtimeStarted = false;
  workerStartupResults = [];
}

export function isJobRuntimeStarted(): boolean {
  return runtimeStarted;
}

export function getRuntimeReadiness(): {
  started: boolean;
  workers: Array<{ name: string; ok: boolean }>;
} {
  return {
    started: runtimeStarted,
    workers: workerStartupResults.map((r) => ({ name: r.name, ok: r.ok })),
  };
}

/** Test-only: reset runtime singleton state without closing Redis. */
export function resetJobRuntimeStateForTests(): void {
  runtimeWorkers.length = 0;
  runtimeStarted = false;
  workerStartupResults = [];
}
