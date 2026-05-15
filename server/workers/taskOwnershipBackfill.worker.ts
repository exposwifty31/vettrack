/**
 * Phase 3 PR 3.2: Task-ownership backfill worker.
 *
 * One job = one clinic. The worker:
 *  1. Pages through `vt_appointments` rows where `acknowledged_user_id IS NULL`
 *     and `metadata->>'acknowledgedBy' IS NOT NULL`.
 *  2. Calls `resolveOwnership` per row (pure, deterministic, no side effects).
 *  3. For `auto_exact_id` / `auto_exact_clerk_id`: updates the appointment's
 *     `acknowledged_user_id` / `acknowledged_at`. Guarded by
 *     `acknowledged_user_id IS NULL` to never overwrite.
 *  4. For `queued` outcomes: inserts a row into
 *     `vt_task_ownership_confirm_queue` with `ON CONFLICT DO NOTHING`.
 *  5. For `skipped` / errors: counters only.
 *
 * Hard constraints (mirroring §8 of the Phase 3 plan):
 *  - Does NOT modify `metadata.acknowledgedBy`.
 *  - Does NOT call `requireClinicalAuthority` or any authority resolver.
 *  - Does NOT emit realtime events, audit-lineage rows, or notifications.
 *  - Does NOT cross clinic boundaries.
 *  - On row-level error: increments error counter and continues.
 *  - `dryRun` skips appointment updates but still inserts queue rows so admins
 *    can review what *would* be queued.
 *
 * Job statistics are stored on the BullMQ job (`updateData` / `updateProgress`)
 * so the admin status endpoint can read them without extra plumbing.
 */
import { randomUUID } from "crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import { appointments, db, taskOwnershipConfirmQueue } from "../db.js";
import { createRedisConnection } from "../lib/redis.js";
import { incrementMetric } from "../lib/metrics.js";
import {
  MATCHER_VERSION,
  resolveOwnership,
  type Resolution,
} from "../lib/task-ownership-resolver.js";
import {
  TASK_OWNERSHIP_BACKFILL_JOB_NAME,
  TASK_OWNERSHIP_BACKFILL_QUEUE_NAME,
  type TaskOwnershipBackfillJobData,
} from "../queues/taskOwnershipBackfill.queue.js";

const PAGE_SIZE = 500;

export interface TaskOwnershipBackfillJobStats {
  scanned: number;
  autoResolved: number;
  queued: number;
  skipped: number;
  error: number;
}

const EMPTY_STATS: TaskOwnershipBackfillJobStats = {
  scanned: 0,
  autoResolved: 0,
  queued: 0,
  skipped: 0,
  error: 0,
};

let backfillWorker: Worker<TaskOwnershipBackfillJobData> | null = null;
let backfillWorkerInitialized = false;

interface AppointmentRow {
  id: string;
  metadata: unknown;
}

function readAcknowledgedBy(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).acknowledgedBy;
  return typeof v === "string" ? v : null;
}

function readAcknowledgedAt(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).acknowledged_at;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function metricForAutoResolve(source: Resolution["source"]): string | null {
  if (source === "auto_exact_id") return "task_ownership_backfill_auto_resolved_id";
  if (source === "auto_exact_clerk_id") return "task_ownership_backfill_auto_resolved_clerk_id";
  return null;
}

function metricForQueuedReason(
  reason: Exclude<Parameters<typeof incrementQueuedReasonMetric>[0], never>,
): string {
  switch (reason) {
    case "NO_CANDIDATE":
      return "task_ownership_backfill_queued_no_candidate";
    case "CROSS_CLINIC_REJECTED":
      return "task_ownership_backfill_queued_cross_clinic";
    case "BLOCKED_USER":
      return "task_ownership_backfill_queued_blocked";
    case "DELETED_USER":
      return "task_ownership_backfill_queued_deleted";
    case "AMBIGUOUS_MATCH":
      return "task_ownership_backfill_queued_ambiguous";
  }
}

// Discriminated overload helper so TypeScript can prove the queued reason is
// one of the five queued variants (excludes EMPTY_RAW_VALUE which is a
// `skipped` outcome, not a queue insert).
function incrementQueuedReasonMetric(
  reason: "NO_CANDIDATE" | "CROSS_CLINIC_REJECTED" | "BLOCKED_USER" | "DELETED_USER" | "AMBIGUOUS_MATCH",
): void {
  incrementMetric(metricForQueuedReason(reason));
}

interface ApplyResolutionInput {
  clinicId: string;
  appointmentId: string;
  rawAcknowledgedBy: string;
  acknowledgedAtFromMetadata: Date | null;
  resolution: Resolution;
  jobId: string;
  dryRun: boolean;
}

export interface ApplyResolutionOutcome {
  autoResolved: boolean;
  queued: boolean;
  skipped: boolean;
}

/**
 * Apply a single resolver outcome to the database. Pulled out as an exported
 * function so the unit tests can exercise it without the BullMQ worker.
 */
export async function applyResolution(input: ApplyResolutionInput): Promise<ApplyResolutionOutcome> {
  const { clinicId, appointmentId, rawAcknowledgedBy, resolution, jobId, dryRun } = input;

  if (resolution.source === "skipped") {
    incrementMetric("task_ownership_backfill_skipped");
    return { autoResolved: false, queued: false, skipped: true };
  }

  if (resolution.source === "queued") {
    // dryRun does not change queue-write semantics (per §8.5): queue rows are
    // always written so admins can review what *would* be queued. The dryRun
    // flag only affects the appointment UPDATE below. ON CONFLICT DO NOTHING
    // enforces idempotency on the (clinic_id, appointment_id, raw) triple.
    await db
      .insert(taskOwnershipConfirmQueue)
      .values({
        id: randomUUID(),
        clinicId,
        appointmentId,
        rawAcknowledgedBy,
        candidateUserIds: resolution.candidateUserIds,
        resolutionReason: resolution.reason,
        matcherVersion: MATCHER_VERSION,
        resolvedSource: "pending",
        createdByJobId: jobId,
      })
      .onConflictDoNothing({
        target: [
          taskOwnershipConfirmQueue.clinicId,
          taskOwnershipConfirmQueue.appointmentId,
          taskOwnershipConfirmQueue.rawAcknowledgedBy,
        ],
      });
    void dryRun; // dryRun intentionally has no effect on queue inserts.
    incrementQueuedReasonMetric(resolution.reason);
    return { autoResolved: false, queued: true, skipped: false };
  }

  // auto-resolve path (auto_exact_id | auto_exact_clerk_id)
  const metricName = metricForAutoResolve(resolution.source);
  if (metricName) incrementMetric(metricName);

  if (dryRun) {
    return { autoResolved: true, queued: false, skipped: false };
  }

  await db
    .update(appointments)
    .set({
      acknowledgedUserId: resolution.userId,
      acknowledgedAt: input.acknowledgedAtFromMetadata ?? new Date(),
    })
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.clinicId, clinicId),
        isNull(appointments.acknowledgedUserId),
      ),
    );

  return { autoResolved: true, queued: false, skipped: false };
}

async function loadBatch(
  clinicId: string,
  cursor: string | null,
  batchSize: number,
): Promise<AppointmentRow[]> {
  // Cursor-based pagination on `appointments.id` (ordered ASC). OFFSET is
  // unsafe here because each iteration mutates rows out of the result set
  // (auto-resolved rows lose their NULL `acknowledged_user_id` and shift
  // remaining rows earlier), which causes OFFSET to skip them. The cursor
  // ensures every eligible row is visited exactly once even when the
  // result set shrinks during the scan.
  const conditions = [
    eq(appointments.clinicId, clinicId),
    isNull(appointments.acknowledgedUserId),
    sql`${appointments.metadata}->>'acknowledgedBy' IS NOT NULL`,
  ];
  if (cursor !== null) {
    conditions.push(sql`${appointments.id} > ${cursor}`);
  }
  return db
    .select({ id: appointments.id, metadata: appointments.metadata })
    .from(appointments)
    .where(and(...conditions))
    .orderBy(asc(appointments.id))
    .limit(batchSize);
}

export async function processBackfillJob(
  job: Job<TaskOwnershipBackfillJobData>,
): Promise<TaskOwnershipBackfillJobStats> {
  const { clinicId, dryRun, limit } = job.data;
  const stats: TaskOwnershipBackfillJobStats = { ...EMPTY_STATS };
  const jobId = job.id ?? randomUUID();

  let cursor: string | null = null;
  while (true) {
    const remaining = limit !== null ? limit - stats.scanned : Number.POSITIVE_INFINITY;
    if (remaining <= 0) break;
    const batchSize = Math.min(PAGE_SIZE, Number.isFinite(remaining) ? remaining : PAGE_SIZE);
    const batch = await loadBatch(clinicId, cursor, batchSize);
    if (batch.length === 0) break;

    for (const row of batch) {
      stats.scanned += 1;
      incrementMetric("task_ownership_backfill_scanned");

      const raw = readAcknowledgedBy(row.metadata);
      if (raw === null) {
        // Defensive: the SQL filter should exclude these, but guard anyway.
        stats.skipped += 1;
        incrementMetric("task_ownership_backfill_skipped");
        continue;
      }

      try {
        const resolution = await resolveOwnership(clinicId, raw);
        const outcome = await applyResolution({
          clinicId,
          appointmentId: row.id,
          rawAcknowledgedBy: raw,
          acknowledgedAtFromMetadata: readAcknowledgedAt(row.metadata),
          resolution,
          jobId,
          dryRun,
        });
        if (outcome.autoResolved) stats.autoResolved += 1;
        if (outcome.queued) stats.queued += 1;
        if (outcome.skipped) stats.skipped += 1;
      } catch (err) {
        stats.error += 1;
        incrementMetric("task_ownership_backfill_error");
        console.error("[task-ownership-backfill] row failed", {
          appointmentId: row.id,
          clinicId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    // Persist running stats so the GET status endpoint can read them while
    // the job is still active.
    await job.updateData({ ...job.data });
    await job.updateProgress({ stats } as unknown as object);

    if (batch.length < batchSize) break;
    // Advance the cursor by the last id we saw in this batch. Subsequent
    // batches load rows strictly greater than this id (ORDER BY id ASC).
    cursor = batch[batch.length - 1].id;
  }

  return stats;
}

export async function startTaskOwnershipBackfillWorker(): Promise<void> {
  if (backfillWorkerInitialized) return;
  const workerConnection = await createRedisConnection();
  if (!workerConnection) {
    console.warn("[task-ownership-backfill] worker disabled (Redis unavailable)");
    return;
  }

  backfillWorker = new Worker<TaskOwnershipBackfillJobData>(
    TASK_OWNERSHIP_BACKFILL_QUEUE_NAME,
    async (job) => {
      if (job.name !== TASK_OWNERSHIP_BACKFILL_JOB_NAME) return;
      const stats = await processBackfillJob(job);
      // Return stats from the processor so they end up on the completed-job
      // BullMQ record (`Job.returnvalue`) for the admin status endpoint.
      return stats;
    },
    { connection: workerConnection },
  );
  backfillWorker.on("error", (err) => {
    console.error("[task-ownership-backfill] worker error", { message: err.message });
  });
  backfillWorkerInitialized = true;
}
