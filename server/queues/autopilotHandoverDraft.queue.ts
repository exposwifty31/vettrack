/**
 * Task 0.3 spike — minimal BullMQ queue wrapper for the Shift-Autopilot
 * handover-draft staging worker. Mirrors
 * `server/queues/staleTaskOwnershipSweep.queue.ts`'s shape, trimmed to spike
 * scope (no dedup-window jobId scheme — the staging call itself is
 * idempotent per `(clinicId, kind, sourceSessionId)`, so a duplicate job for
 * the same shift session is a harmless no-op, not a correctness hazard).
 *
 * Redis is optional in dev (per CLAUDE.md) — if unavailable, enqueue throws
 * and the worker's periodic scan just logs and skips that tick.
 */
import { Queue, type Job } from "bullmq";
import { createRedisConnection, getRedisUrl } from "../lib/redis.js";

export const AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME = "autopilot-handover-draft";
export const AUTOPILOT_HANDOVER_DRAFT_JOB_NAME = "autopilot-handover-draft";

export interface AutopilotHandoverDraftJobData {
  clinicId: string;
  shiftSessionId: string;
}

let queue: Queue<AutopilotHandoverDraftJobData> | null = null;
let queueInitFailed = false;

async function getQueue(): Promise<Queue<AutopilotHandoverDraftJobData>> {
  if (queue) return queue;
  if (queueInitFailed) throw new Error("autopilot-handover-draft queue unavailable");
  if (!getRedisUrl()) {
    queueInitFailed = true;
    throw new Error("autopilot-handover-draft queue disabled: REDIS_URL missing");
  }
  const connection = await createRedisConnection();
  if (!connection) {
    queueInitFailed = true;
    throw new Error("autopilot-handover-draft queue unavailable: Redis connection failed");
  }
  queue = new Queue<AutopilotHandoverDraftJobData>(AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME, {
    connection,
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 200, removeOnFail: 500 },
  });
  queue.on("error", (error) => {
    console.error("[autopilot-handover-draft-queue] queue error", { message: error.message });
  });
  return queue;
}

export const autopilotHandoverDraftQueue = {
  async enqueue(data: AutopilotHandoverDraftJobData): Promise<Job<AutopilotHandoverDraftJobData>> {
    const q = await getQueue();
    // One job per (clinic, shiftSession) — a re-enqueue for the same shift
    // collapses via BullMQ's jobId de-dup; the staging call is ALSO
    // idempotent, so this is belt-and-suspenders, not load-bearing.
    return q.add(AUTOPILOT_HANDOVER_DRAFT_JOB_NAME, data, {
      jobId: `${AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME}:${data.clinicId}:${data.shiftSessionId}`,
    });
  },
};
