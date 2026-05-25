import type { Job, JobsOptions } from "bullmq";
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
 * Not yet wired into production call sites — Phase 1a skeleton only.
 */
export async function enqueueJob<K extends StaticJobKind>(
  kind: K,
  payload: PayloadForStaticKind[K],
  options?: EnqueueJobOptions,
): Promise<Job<PayloadForStaticKind[K]>> {
  const definition = getStaticJobDefinition(kind);
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
}

/**
 * Enqueue integration sync with legacy dynamic `job.name` and shard queue routing.
 */
export async function enqueueIntegrationSyncJob(
  data: IntegrationSyncJobData,
  options?: JobsOptions,
): Promise<Job<IntegrationSyncJobData>> {
  const queueName = integrationQueueForPayload(data);
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
}
