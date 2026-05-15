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

/**
 * Time-bucketed jobId deduplication window (milliseconds).
 *
 * BullMQ treats any job whose id matches an already-enqueued or
 * already-completed-but-not-yet-removed job as a duplicate and silently
 * drops it. The queue uses `removeOnComplete: 1000`, so completed jobs
 * remain in Redis until 1000 newer jobs push them out. A FULLY static
 * per-clinic jobId would therefore permanently block re-enqueues for
 * low-volume clinics after the first sweep completes.
 *
 * The dedup window must satisfy two constraints:
 *   - Wide enough that operator/cron-triggered concurrent enqueues for
 *     the same clinic (typically within seconds) are collapsed into one
 *     job — this is the original §11.5 lease invariant we want.
 *   - Narrow enough that subsequent scheduled or manual sweeps in the
 *     same clinic can re-enqueue without operator intervention.
 *
 * 60s is a defensible default: human triggers and the scheduler are
 * never expected to fire faster than this, and post-completion
 * re-enqueues after the window roll over to a fresh id.
 */
const STALE_TASK_OWNERSHIP_SWEEP_DEDUP_WINDOW_MS = 60_000;

export const staleTaskOwnershipSweepQueue = {
  async enqueue(
    data: StaleTaskOwnershipSweepJobData,
    options?: JobsOptions,
  ): Promise<Job<StaleTaskOwnershipSweepJobData>> {
    const q = await getQueue();
    // Time-bucketed deterministic jobId per (clinic, dedupWindowBucket).
    // Within one dedup window, multiple enqueues for the same clinic
    // collapse into a single job (the §11.5 lease invariant). After the
    // window rolls over, a new bucket value yields a new jobId so future
    // sweeps can run normally even though prior completed jobs are still
    // retained in Redis under `removeOnComplete: 1000`.
    //
    // Trade-off: if a single sweep ever runs longer than the dedup
    // window, two consecutive enqueues straddling the boundary could
    // create concurrent jobs in a multi-worker deployment. Mitigated
    // operationally by the §11.5 sweep cadence being slower than the
    // window. A full cross-job lock is out of PR 3.6.1 minimal scope.
    const bucket = Math.floor(Date.now() / STALE_TASK_OWNERSHIP_SWEEP_DEDUP_WINDOW_MS);
    const jobId = options?.jobId ?? `${STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME}:${data.clinicId}:${bucket}`;
    return q.add(STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME, data, {
      ...defaultJobOptions,
      ...(options ?? {}),
      jobId,
    });
  },
};
