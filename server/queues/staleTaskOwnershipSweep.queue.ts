/**
 * Phase 3 PR 3.6 — BullMQ queue wrapper for the stale-task-ownership sweeper.
 *
 * One job = one clinic. The sweeper is off-default; jobs only do meaningful
 * work when the per-clinic mode resolver returns `shadow` or `enforce`. In
 * `off`, the worker short-circuits before scanning any rows.
 *
 * PR 3.6 ships infrastructure only — no live revocation regardless of mode.
 * See `staleTaskOwnershipSweepWorker.ts` for the worker semantics.
 *
 * Redis is optional in dev (per CLAUDE.md). If `REDIS_URL` is missing, the
 * sweeper is silently disabled. Production requires Redis.
 */
import { JobsOptions, Queue, type Job } from "bullmq";
import { createRedisConnection, getRedisUrl } from "../lib/redis.js";

export const STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME = "stale-task-ownership-sweep";
export const STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME = "stale-task-ownership-sweep";

export interface StaleTaskOwnershipSweepJobData {
  /** Clinic the sweep is scoped to. */
  clinicId: string;
  /** Caller user id for traceability (no auth decisions). */
  requestedByUserId: string;
  /** Optional safety cap on rows processed in this job. */
  limit: number | null;
}

let queue: Queue<StaleTaskOwnershipSweepJobData> | null = null;
let queueInitFailed = false;

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

async function getQueue(): Promise<Queue<StaleTaskOwnershipSweepJobData>> {
  if (queue) return queue;
  if (queueInitFailed) throw new Error("stale-task-ownership-sweep queue unavailable");
  if (!getRedisUrl()) {
    queueInitFailed = true;
    throw new Error("stale-task-ownership-sweep queue disabled: REDIS_URL missing");
  }

  const connection = await createRedisConnection();
  if (!connection) {
    queueInitFailed = true;
    throw new Error("stale-task-ownership-sweep queue unavailable: Redis connection failed");
  }

  queue = new Queue<StaleTaskOwnershipSweepJobData>(STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME, {
    connection,
    defaultJobOptions,
  });
  queue.on("error", (error) => {
    console.error("[stale-task-ownership-sweep-queue] queue error", { message: error.message });
  });
  return queue;
}

export const staleTaskOwnershipSweepQueue = {
  async enqueue(
    data: StaleTaskOwnershipSweepJobData,
    options?: JobsOptions,
  ): Promise<Job<StaleTaskOwnershipSweepJobData>> {
    const q = await getQueue();
    return q.add(STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME, data, {
      ...defaultJobOptions,
      ...(options ?? {}),
    });
  },
};
