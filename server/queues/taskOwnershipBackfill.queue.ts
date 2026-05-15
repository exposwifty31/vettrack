/**
 * Phase 3 PR 3.2: BullMQ queue wrapper for the task-ownership backfill worker.
 *
 * One job = one clinic. The admin API (`POST /api/admin/task-ownership/backfill`)
 * enqueues a job; the worker processes it asynchronously. The worker is
 * idempotent: re-running the same `clinicId` is safe and produces no
 * duplicate queue rows (see `vt_task_ownership_confirm_queue` uniqueness).
 *
 * Redis is optional in dev (per CLAUDE.md). If `REDIS_URL` is missing or the
 * connection fails, `enqueue` throws a stable error that the admin route
 * surfaces as `503 QUEUE_UNAVAILABLE`.
 */
import { JobsOptions, Queue, type Job } from "bullmq";
import { createRedisConnection, getRedisUrl } from "../lib/redis.js";

export const TASK_OWNERSHIP_BACKFILL_QUEUE_NAME = "task-ownership-backfill";
export const TASK_OWNERSHIP_BACKFILL_JOB_NAME = "task-ownership-backfill";

export interface TaskOwnershipBackfillJobData {
  /** Clinic the backfill is scoped to. Worker filters all reads/writes by this id. */
  clinicId: string;
  /** When true, the worker writes queue rows but never updates `vt_appointments`. */
  dryRun: boolean;
  /** Optional safety cap on rows processed in this job. */
  limit: number | null;
  /** Caller user id, recorded in job metadata for traceability (no auth decisions). */
  requestedByUserId: string;
}

let queue: Queue<TaskOwnershipBackfillJobData> | null = null;
let queueInitFailed = false;

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

async function getQueue(): Promise<Queue<TaskOwnershipBackfillJobData>> {
  if (queue) return queue;
  if (queueInitFailed) throw new Error("task-ownership-backfill queue unavailable");
  if (!getRedisUrl()) {
    queueInitFailed = true;
    throw new Error("task-ownership-backfill queue disabled: REDIS_URL missing");
  }

  const connection = await createRedisConnection();
  if (!connection) {
    queueInitFailed = true;
    throw new Error("task-ownership-backfill queue unavailable: Redis connection failed");
  }

  queue = new Queue<TaskOwnershipBackfillJobData>(TASK_OWNERSHIP_BACKFILL_QUEUE_NAME, {
    connection,
    defaultJobOptions,
  });
  queue.on("error", (error) => {
    console.error("[task-ownership-backfill-queue] queue error", { message: error.message });
  });
  return queue;
}

export const taskOwnershipBackfillQueue = {
  async enqueue(
    data: TaskOwnershipBackfillJobData,
    options?: JobsOptions,
  ): Promise<Job<TaskOwnershipBackfillJobData>> {
    const q = await getQueue();
    return q.add(TASK_OWNERSHIP_BACKFILL_JOB_NAME, data, {
      ...defaultJobOptions,
      ...(options ?? {}),
    });
  },

  async getJob(jobId: string): Promise<Job<TaskOwnershipBackfillJobData> | undefined> {
    const q = await getQueue();
    return q.getJob(jobId);
  },
};
