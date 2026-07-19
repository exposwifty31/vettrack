/**
 * Task 0.3 spike — "Shift Autopilot" handover-draft staging worker.
 *
 * Periodically scans for recently-ended `vt_shift_sessions` (same lookback
 * shape as `server/lib/shift-handover-scheduler.ts`'s
 * `scanEndedShiftsForHandover`, deliberately NOT shared code — see the
 * module doc there: that scheduler is a frozen, live production path this
 * spike must not touch) and enqueues ONE staging job per ended session. The
 * BullMQ worker consumes those jobs and calls
 * `composeAndStageHandoverDraft`, reusing the SAME `resolveShiftWindow` +
 * (now-exported) `aggregateDeltas` the shipped R-SH-F1 generator uses, so the
 * proposal's content is computed identically to the live auto-published
 * handover — only the DESTINATION differs (a staged `action_proposal`
 * row awaiting human approve/edit/reject, vs. R-SH-F1's immediate
 * persist-and-push). See spike findings §7 for the open product question
 * this raises.
 *
 * This worker is NEVER wired into `generateShiftHandover` or
 * `shift-handover-scheduler.ts` — it reads the same `vt_shift_sessions`
 * table independently and writes to a completely separate table
 * (`vt_action_proposal`).
 */
import { and, gte, isNotNull, lt } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import { db, shiftSessions } from "../db.js";
import { createRedisConnection } from "../lib/redis.js";
import { resolveShiftWindow, aggregateDeltas } from "../lib/shift-handover-generator.js";
import { composeAndStageHandoverDraft } from "../lib/autopilot/action-proposal-service.js";
import { DrizzleActionProposalWriter } from "../lib/autopilot/action-proposal-writer.port.js";
import {
  autopilotHandoverDraftQueue,
  AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME,
  AUTOPILOT_HANDOVER_DRAFT_JOB_NAME,
  type AutopilotHandoverDraftJobData,
} from "../queues/autopilotHandoverDraft.queue.js";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 15 * 60 * 1000;

const writer = new DrizzleActionProposalWriter();

/** Exported for testability without going through BullMQ — mirrors the sweeper worker's `processXJob` convention. */
export async function processAutopilotHandoverDraftJob(
  data: AutopilotHandoverDraftJobData,
): Promise<void> {
  const window = await resolveShiftWindow(data.clinicId, data.shiftSessionId);
  const deltas = await aggregateDeltas(data.clinicId, window);
  await composeAndStageHandoverDraft({
    clinicId: data.clinicId,
    shiftSessionId: data.shiftSessionId,
    window,
    deltas,
    writer,
  });
}

async function scanEndedShiftsForAutopilotDraft(): Promise<void> {
  try {
    const now = Date.now();
    const since = new Date(now - LOOKBACK_MS);
    const until = new Date(now);

    const ended = await db
      .select({ id: shiftSessions.id, clinicId: shiftSessions.clinicId })
      .from(shiftSessions)
      .where(
        and(
          isNotNull(shiftSessions.endedAt),
          gte(shiftSessions.endedAt, since),
          lt(shiftSessions.endedAt, until),
        ),
      );

    for (const session of ended) {
      try {
        await autopilotHandoverDraftQueue.enqueue({ clinicId: session.clinicId, shiftSessionId: session.id });
      } catch (err) {
        console.error("[autopilot-handover-draft-worker] enqueue failed", {
          sessionId: session.id,
          clinicId: session.clinicId,
          err,
        });
      }
    }
  } catch (err) {
    console.error("[autopilot-handover-draft-worker] scan failed:", err);
  }
}

let worker: Worker<AutopilotHandoverDraftJobData> | null = null;
let initialized = false;

export async function startAutopilotHandoverDraftWorker(): Promise<void> {
  if (initialized) return;
  const connection = await createRedisConnection();
  if (!connection) {
    console.warn("[autopilot-handover-draft-worker] disabled (Redis unavailable)");
    return;
  }

  worker = new Worker<AutopilotHandoverDraftJobData>(
    AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME,
    async (job: Job<AutopilotHandoverDraftJobData>) => {
      if (job.name !== AUTOPILOT_HANDOVER_DRAFT_JOB_NAME) return;
      await processAutopilotHandoverDraftJob(job.data);
    },
    { connection },
  );
  worker.on("error", (err) => {
    console.error("[autopilot-handover-draft-worker] worker error", { message: err.message });
  });

  initialized = true;
  void scanEndedShiftsForAutopilotDraft().catch(() => {});
  setInterval(() => {
    void scanEndedShiftsForAutopilotDraft().catch(() => {});
  }, SCAN_INTERVAL_MS);
}
