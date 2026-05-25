import type { Job, JobsOptions } from "bullmq";
import { incrementMetric } from "../lib/metrics.js";
import {
  buildStaleTaskOwnershipSweepJobId,
  defaultIntegrationJobId,
  getStaticJobDefinition,
  integrationBullmqJobName,
  integrationQueueForPayload,
  integrationSyncEnqueueDefinition,
  type IntegrationSyncJobData,
  type PayloadForStaticKind,
} from "./definitions/index.js";
import { mergeEnqueueJobOptions, type StaticJobKind } from "./registry.js";
import { getOrCreateQueue } from "./queue-factory.js";

export type EnqueueJobOptions = {
  jobId?: string;
  delayMs?: number;
  /** Merged after definition defaults (same precedence as existing queue wrappers). */
  bullmq?: JobsOptions;
};

type EnqueueQueueUnavailableReason =
  | "REDIS_URL_MISSING"
  | "REDIS_CONNECTION_FAILED"
  | "QUEUE_INIT_FAILED";

const INTEGRATION_SYNC_ENQUEUE_KIND = "integration-sync-enqueue" as const;

function isEnqueueQueueUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("queue disabled") ||
    message.includes("queue unavailable") ||
    message.includes("REDIS_URL missing") ||
    message.includes("Redis connection failed")
  );
}

function deriveEnqueueQueueUnavailableReason(
  error: unknown,
): EnqueueQueueUnavailableReason {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("REDIS_URL missing")) {
    return "REDIS_URL_MISSING";
  }
  if (message.includes("Redis connection failed")) {
    return "REDIS_CONNECTION_FAILED";
  }
  return "QUEUE_INIT_FAILED";
}

function observeEnqueueQueueUnavailable(params: {
  kind: StaticJobKind | typeof INTEGRATION_SYNC_ENQUEUE_KIND;
  queueName: string;
  reason: EnqueueQueueUnavailableReason;
}): void {
  incrementMetric("job_enqueue_queue_unavailable");
  console.warn("[job-enqueue]", {
    event: "job_enqueue_queue_unavailable",
    kind: params.kind,
    queueName: params.queueName,
    reason: params.reason,
  });
}

async function withEnqueueQueueObservability<T>(
  kind: StaticJobKind | typeof INTEGRATION_SYNC_ENQUEUE_KIND,
  queueName: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isEnqueueQueueUnavailableError(error)) {
      observeEnqueueQueueUnavailable({
        kind,
        queueName,
        reason: deriveEnqueueQueueUnavailableReason(error),
      });
    }
    throw error;
  }
}

function buildAddOptions(
  definition: ReturnType<typeof getStaticJobDefinition>,
  options?: EnqueueJobOptions,
): JobsOptions {
  const merged = mergeEnqueueJobOptions(definition, options?.bullmq);
  if (options?.jobId) {
    merged.jobId = options.jobId;
  }
  if (options?.delayMs != null) {
    merged.delay = options.delayMs;
  }
  return merged;
}

/**
 * Enqueue a static BullMQ job by {@link StaticJobKind} (matches existing `job.name`).
 * Production: {@link enqueueChargeAlertJob} delegates `check-plug` (1c-1);
 * `inventoryDeductionQueue.add` in inventory-deduction.queue.ts delegates
 * `inventory-deduction` (1c-2).
 */
export async function enqueueJob<K extends StaticJobKind>(
  kind: K,
  payload: PayloadForStaticKind[K],
  options?: EnqueueJobOptions,
): Promise<Job<PayloadForStaticKind[K]>> {
  const definition = getStaticJobDefinition(kind);
  return withEnqueueQueueObservability(kind, definition.queue, async () => {
    const queue = await getOrCreateQueue<PayloadForStaticKind[K]>({
      queueName: definition.queue,
      defaultJobOptions: mergeEnqueueJobOptions(definition),
      logLabel: `${definition.queue}-queue`,
    });

    let addOptions = buildAddOptions(definition, options);

    if (kind === "stale-task-ownership-sweep") {
      const sweepPayload = payload as PayloadForStaticKind["stale-task-ownership-sweep"];
      addOptions = {
        ...addOptions,
        jobId:
          options?.jobId ?? buildStaleTaskOwnershipSweepJobId(sweepPayload.clinicId),
      };
    }

    const jobName = definition.bullmqJobName ?? definition.kind;
    // BullMQ name/data generics are narrower than our StaticJobKind union under server-check tsconfig.
    return queue.add(jobName as never, payload as never, addOptions) as Promise<
      Job<PayloadForStaticKind[K]>
    >;
  });
}

/**
 * Enqueue integration sync with legacy dynamic `job.name` and shard queue routing.
 */
export async function enqueueIntegrationSyncJob(
  data: IntegrationSyncJobData,
  options?: JobsOptions,
): Promise<Job<IntegrationSyncJobData>> {
  const queueName = integrationQueueForPayload(data);
  return withEnqueueQueueObservability(
    INTEGRATION_SYNC_ENQUEUE_KIND,
    queueName,
    async () => {
      const meta = integrationSyncEnqueueDefinition;
      const queue = await getOrCreateQueue<IntegrationSyncJobData>({
        queueName,
        defaultJobOptions: {
          attempts: meta.attempts,
          backoff: meta.backoff,
          removeOnComplete: meta.removeOnComplete,
          removeOnFail: meta.removeOnFail,
        },
        logLabel: "integration-queue",
      });

      const jobName = integrationBullmqJobName(data);
      return queue.add(jobName, data, {
        attempts: meta.attempts,
        backoff: meta.backoff,
        removeOnComplete: meta.removeOnComplete,
        removeOnFail: meta.removeOnFail,
        ...(options ?? {}),
        jobId: options?.jobId ?? defaultIntegrationJobId(data),
      });
    },
  );
}
