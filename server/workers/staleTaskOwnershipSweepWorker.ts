/**
 * Phase 3 PR 3.6 — Stale-task-ownership sweeper worker.
 *
 * Sweeper isolation rules (§11.5):
 *   - clinic-scoped: one job processes one clinic
 *   - acquires a BullMQ-backed lease (one runner per clinic via the
 *     queue's at-most-once-active semantics)
 *   - avoids cross-clinic scans (the SQL filter is parameterized)
 *   - avoids global locks
 *   - pauses during emergency suspend (per §11.5 — handled by the
 *     evaluator's emergencySuspend short-circuit)
 *   - pauses during degraded mode (resolver unavailable — handled by the
 *     evaluator's resolverOperational short-circuit)
 *
 * Per §11.8 — PR 3.6 MUST NOT emit live ownership revocations. The worker
 * scans, evaluates, increments counters, optionally emits shadow-mode
 * audit observations via the evaluator, and exits. No UPDATE statement
 * modifies appointment ownership in this worker. Live revocation arrives
 * in PR 3.8 (master plan §13.3 asymmetry).
 *
 * The worker is off-default. It only does work when the per-clinic mode
 * resolver returns shadow or enforce. Even in enforce, the worker DOES
 * NOT revoke in PR 3.6 — the revocation code path is intentionally absent
 * until PR 3.8 adds it within its tightly-bounded carve-out.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Worker, type Job } from "bullmq";
import { appointments, clinicalCheckIns, db } from "../db.js";
import { createRedisConnection } from "../lib/redis.js";
import { resolveStaleTaskOwnershipEnforcementMode } from "../lib/authority/enforcement/config.js";
import { evaluateStaleTaskOwnership } from "../lib/authority/enforcement/stale-task-ownership.evaluator.js";
import { staleTaskOwnershipMetrics } from "../lib/authority/enforcement/stale-task-ownership.metrics.js";
import {
  emitStaleTaskOwnershipRevokedAudit,
  emitStaleTaskOwnershipSweeperLifecycle,
} from "../lib/authority/enforcement/stale-task-ownership.audit.js";
import {
  STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME,
  STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME,
  type StaleTaskOwnershipSweepJobData,
} from "../queues/staleTaskOwnershipSweep.queue.js";

const PAGE_SIZE = 200;
const DEFAULT_GRACE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const ACTIVE_STATUSES = ["assigned", "scheduled", "arrived", "in_progress", "approved"];

let sweeperWorker: Worker<StaleTaskOwnershipSweepJobData> | null = null;
let sweeperWorkerInitialized = false;

export interface StaleTaskOwnershipSweepStats {
  scanned: number;
  notStale: number;
  activeTreatmentProtected: number;
  wouldHaveRevoked: number;
  /** Tombstone — PR 3.6 ALWAYS keeps this at 0 (no revocation in PR 3.6). */
  revoked: number;
  emergencySuspendSkip: number;
  degradedModePause: number;
  error: number;
}

const EMPTY_STATS: StaleTaskOwnershipSweepStats = {
  scanned: 0,
  notStale: 0,
  activeTreatmentProtected: 0,
  wouldHaveRevoked: 0,
  revoked: 0,
  emergencySuspendSkip: 0,
  degradedModePause: 0,
  error: 0,
};

interface AppointmentSweepRow {
  id: string;
  acknowledgedUserId: string;
  acknowledgedAt: Date | null;
  status: string;
  updatedAt: Date;
}

async function loadBatch(
  clinicId: string,
  cursor: string | null,
  batchSize: number,
): Promise<AppointmentSweepRow[]> {
  // PR 3.6.1: include `acknowledged_user_id <> ''` in the SQL filter so
  // empty-string values are excluded at the database layer. Without this
  // the previous post-query `.filter()` could reduce the batch size below
  // `batchSize`, which the pagination loop misinterprets as end-of-data
  // and prematurely terminates — permanently skipping subsequent rows
  // for the clinic. With the SQL-side check the JS filter becomes a
  // pure type narrowing and the row count from the DB reliably reflects
  // "more data available."
  const conditions = [
    eq(appointments.clinicId, clinicId),
    sql`${appointments.acknowledgedUserId} IS NOT NULL`,
    ne(appointments.acknowledgedUserId, ""),
    inArray(appointments.status, ACTIVE_STATUSES),
  ];
  if (cursor !== null) {
    conditions.push(sql`${appointments.id} > ${cursor}`);
  }
  const rows = await db
    .select({
      id: appointments.id,
      acknowledgedUserId: appointments.acknowledgedUserId,
      acknowledgedAt: appointments.acknowledgedAt,
      status: appointments.status,
      updatedAt: appointments.updatedAt,
    })
    .from(appointments)
    .where(and(...conditions))
    .orderBy(appointments.id)
    .limit(batchSize);
  // Type narrowing only: the SQL filter already guarantees these values
  // are non-null non-empty strings. The previous filter could DROP rows
  // and corrupt pagination; this version cannot.
  return rows.map((r) => ({
    id: r.id,
    acknowledgedUserId: r.acknowledgedUserId as string,
    acknowledgedAt: r.acknowledgedAt,
    status: r.status,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Look up the most recent check-in for a user. Returns the checkedOutAt
 * timestamp; null means the user is currently checked in (open check-in
 * exists) or has no check-in history (treated identically for staleness
 * — the evaluator's ownerCheckInEndedAt === null → not stale).
 */
async function fetchOwnerCheckInEndedAt(userId: string, clinicId: string): Promise<Date | null> {
  // Prefer any open check-in (checked_out_at IS NULL) — if present, owner
  // is currently checked in and ownership is not stale.
  const open = await db
    .select({ id: clinicalCheckIns.id })
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        eq(clinicalCheckIns.userId, userId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .limit(1);
  if (open.length > 0) return null;

  // Otherwise return the most recent checked_out_at value (most recent
  // closed check-in).
  const closed = await db
    .select({ checkedOutAt: clinicalCheckIns.checkedOutAt })
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        eq(clinicalCheckIns.userId, userId),
      ),
    )
    .orderBy(sql`${clinicalCheckIns.checkedOutAt} DESC NULLS LAST`)
    .limit(1);
  return closed[0]?.checkedOutAt ?? null;
}

/**
 * Process a single sweeper job. Exported for unit testing without going
 * through BullMQ. The job-statistics object accumulates counters used by
 * the worker's lifecycle audit.
 */
export async function processStaleTaskOwnershipSweepJob(
  job: Job<StaleTaskOwnershipSweepJobData>,
  options: {
    /** Test seam: inject a mode resolver (defaults to env-backed). */
    modeResolver?: typeof resolveStaleTaskOwnershipEnforcementMode;
    /** Test seam: inject a check-in lookup. */
    fetchOwnerCheckInEndedAt?: (userId: string, clinicId: string) => Promise<Date | null>;
    /** Test seam: inject emergency-suspend probe. PR 3.7+ owns this; PR 3.6 default = false. */
    emergencySuspendForClinic?: (clinicId: string) => Promise<boolean>;
    /** Test seam: inject resolver-operational probe. PR 3.7+ owns this; PR 3.6 default = true. */
    resolverOperationalForClinic?: (clinicId: string) => Promise<boolean>;
    graceWindowMs?: number;
    activityWindowMs?: number;
    nowSupplier?: () => Date;
  } = {},
): Promise<StaleTaskOwnershipSweepStats> {
  const stats: StaleTaskOwnershipSweepStats = { ...EMPTY_STATS };
  const clinicId = job.data.clinicId;
  const jobId = job.id ?? "unknown";
  const modeResolver = options.modeResolver ?? resolveStaleTaskOwnershipEnforcementMode;
  const lookupOwnerCheckIn = options.fetchOwnerCheckInEndedAt ?? fetchOwnerCheckInEndedAt;
  const isEmergencySuspended = options.emergencySuspendForClinic ?? (async () => false);
  const isResolverOperational = options.resolverOperationalForClinic ?? (async () => true);
  const graceWindowMs = options.graceWindowMs ?? DEFAULT_GRACE_WINDOW_MS;
  const activityWindowMs = options.activityWindowMs ?? DEFAULT_ACTIVITY_WINDOW_MS;
  const nowSupplier = options.nowSupplier ?? (() => new Date());

  emitStaleTaskOwnershipSweeperLifecycle({ clinicId, event: "started", jobId });

  // Off-mode short-circuit: do not scan, do not load any row, do not query
  // the db. This preserves the §11.11 #2 invariant ("worker remains inert
  // in off mode").
  const mode = await modeResolver(clinicId);
  if (mode === "off") {
    emitStaleTaskOwnershipSweeperLifecycle({
      clinicId,
      event: "completed",
      jobId,
      metadata: { mode, stats },
    });
    return stats;
  }

  const emergencySuspend = await isEmergencySuspended(clinicId);
  const resolverOperational = await isResolverOperational(clinicId);

  // PR 3.6.1: job-level short-circuit when the clinic is in an incident
  // state. The evaluator already short-circuits per-row, but per §11.5
  // the sweeper itself must "pause during degraded mode" and "pause
  // during emergency suspend" — meaning it should NOT scan or do any
  // per-row check-in lookup. The previous version still ran full row
  // scans and per-row check-in lookups even when these flags were set,
  // which is the opposite of what they're meant to do during an
  // incident. Now we skip the scan entirely and record exactly one
  // counter increment per pause-condition for observability.
  if (emergencySuspend) {
    staleTaskOwnershipMetrics.emergencySuspendSkip();
    stats.emergencySuspendSkip = 1;
    emitStaleTaskOwnershipSweeperLifecycle({
      clinicId,
      event: "completed",
      jobId,
      metadata: { mode, stats, pausedReason: "EMERGENCY_SUSPEND" },
    });
    return stats;
  }
  if (!resolverOperational) {
    staleTaskOwnershipMetrics.degradedModePause();
    stats.degradedModePause = 1;
    emitStaleTaskOwnershipSweeperLifecycle({
      clinicId,
      event: "completed",
      jobId,
      metadata: { mode, stats, pausedReason: "DEGRADED_MODE" },
    });
    return stats;
  }

  const limit = job.data.limit ?? Number.POSITIVE_INFINITY;
  let cursor: string | null = null;
  while (true) {
    const remaining = Number.isFinite(limit) ? limit - stats.scanned : Number.POSITIVE_INFINITY;
    if (remaining <= 0) break;
    const batchSize = Math.min(PAGE_SIZE, Number.isFinite(remaining) ? remaining : PAGE_SIZE);
    const batch = await loadBatch(clinicId, cursor, batchSize);
    if (batch.length === 0) break;

    for (const row of batch) {
      stats.scanned += 1;
      staleTaskOwnershipMetrics.scanned();
      try {
        const ownerCheckInEndedAt = await lookupOwnerCheckIn(row.acknowledgedUserId, clinicId);
        const verdict = await evaluateStaleTaskOwnership(
          {
            clinicId,
            now: nowSupplier(),
            graceWindowMs,
            activityWindowMs,
            emergencySuspend,
            resolverOperational,
            task: {
              id: row.id,
              acknowledgedUserId: row.acknowledgedUserId,
              acknowledgedAt: row.acknowledgedAt,
              status: row.status,
              updatedAt: row.updatedAt,
            },
            ownerCheckInEndedAt,
          },
          { modeResolver: async () => mode },
        );

        if (verdict.action === "allow") {
          if (verdict.protected === "ACTIVE_TREATMENT") {
            stats.activeTreatmentProtected += 1;
          } else if (verdict.protected === "EMERGENCY_SUSPEND") {
            stats.emergencySuspendSkip += 1;
          } else if (verdict.protected === "DEGRADED_MODE") {
            stats.degradedModePause += 1;
          } else if (verdict.protected === "WOULD_HAVE_REVOKED_SHADOW") {
            stats.wouldHaveRevoked += 1;
          } else {
            stats.notStale += 1;
          }
        } else {
          // verdict.action === "would_revoke".
          //
          // Phase 3 PR 3.8 — Live revocation activation (§13.3 / §13.16).
          // PR 3.6 shipped this branch as a no-op (observation-only). PR 3.8
          // adds the minimal code to perform the actual revocation IF mode
          // is `enforce`. In shadow, the verdict is still observed only
          // (counter increment happens inside the evaluator).
          //
          // Active-treatment safety floor: the evaluator already prevents
          // `would_revoke` from being produced for active-treatment tasks
          // (returns `allow + protected: ACTIVE_TREATMENT` instead). The
          // safety floor is therefore preserved structurally; no
          // additional guard is needed at this call site.
          if (mode === "enforce") {
            const ownerUserId = row.acknowledgedUserId;
            // Reset status from in_progress → assigned per doctrine §3.4
            // ("task remains in the queue, re-claimable"); other statuses
            // are left untouched. Atomicity guard: only revoke if the
            // owner is still the same person we evaluated (no race with a
            // re-acknowledge in flight).
            const newStatus = row.status === "in_progress" ? "assigned" : row.status;
            // §13.7 transactional-audit invariant: the ownership UPDATE
            // and the revocation audit row must be written in the SAME
            // transaction. A process crash between them would leave the
            // revocation without an audit trail, breaking the revocation
            // history.
            const revocationCommitted = await db.transaction(async (tx) => {
              const updated = await tx
                .update(appointments)
                .set({
                  acknowledgedUserId: null,
                  acknowledgedAt: null,
                  status: newStatus,
                  updatedAt: nowSupplier(),
                })
                .where(
                  and(
                    eq(appointments.id, row.id),
                    eq(appointments.clinicId, clinicId),
                    eq(appointments.acknowledgedUserId, ownerUserId),
                  ),
                )
                .returning({ id: appointments.id });
              if (updated.length === 0) {
                // Lost race; rollback by not committing the audit row.
                return false;
              }
              const auditPromise = emitStaleTaskOwnershipRevokedAudit({
                clinicId,
                taskId: row.id,
                ownerUserId,
                ownerCheckInEndedAt,
                taskUpdatedAt: row.updatedAt,
                graceWindowMs,
                activityWindowMs,
                previousStatus: row.status,
                newStatus,
                tx,
                // §13.7 transactional-audit invariant: live revocation
                // audit rows MUST be written. Bypass the AUTHORITY_OBS_V1
                // observability gate AND the rate limiter so the audit
                // is unconditional inside the transaction. Without this,
                // an OBS-V1=off configuration would silently allow
                // revocations to commit without an audit trail.
                force: true,
              });
              if (auditPromise && typeof (auditPromise as Promise<unknown>).then === "function") {
                await auditPromise;
              }
              return true;
            });

            if (revocationCommitted) {
              stats.revoked += 1;
              staleTaskOwnershipMetrics.revoked();
            } else {
              // Lost race: another writer (acknowledge / explicit
              // reassign) changed the owner between our evaluator call
              // and our UPDATE. Treat as a non-revocation; the next
              // sweep will re-evaluate.
              stats.wouldHaveRevoked += 1;
            }
          } else {
            // mode === "shadow" — would-revoke counted in stats. The
            // wouldHaveRevoked metric counter was already incremented
            // by the evaluator. Sweeper does NOT touch the appointment.
            stats.wouldHaveRevoked += 1;
          }
        }
      } catch (err) {
        stats.error += 1;
        console.error("[stale-task-ownership-sweeper] row failed", {
          clinicId,
          taskId: row.id,
          error: err instanceof Error ? err.message : err,
        });
      }
    }

    if (batch.length < batchSize) break;
    cursor = batch[batch.length - 1].id;
  }

  emitStaleTaskOwnershipSweeperLifecycle({
    clinicId,
    event: "completed",
    jobId,
    metadata: { mode, stats },
  });
  return stats;
}

export async function startStaleTaskOwnershipSweepWorker(): Promise<void> {
  if (sweeperWorkerInitialized) return;
  const workerConnection = await createRedisConnection();
  if (!workerConnection) {
    console.warn("[stale-task-ownership-sweeper] worker disabled (Redis unavailable)");
    return;
  }

  sweeperWorker = new Worker<StaleTaskOwnershipSweepJobData>(
    STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME,
    async (job) => {
      if (job.name !== STALE_TASK_OWNERSHIP_SWEEP_JOB_NAME) return;
      return processStaleTaskOwnershipSweepJob(job);
    },
    { connection: workerConnection },
  );
  sweeperWorker.on("error", (err) => {
    console.error("[stale-task-ownership-sweeper] worker error", { message: err.message });
  });
  sweeperWorkerInitialized = true;
}
