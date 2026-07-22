/**
 * VetTrack 2.0, Task 1.1 §2 — `shift_handover_draft` scan worker.
 *
 * PARALLEL-RUN SCOPE BOUNDARY (binding for this slice, disclosed at dispatch):
 * R-SH-F1's auto-publish path — `server/lib/shift-handover-scheduler.ts`
 * (`scanEndedShiftsForHandover` / `startShiftHandoverScheduler`) and its
 * registration in `server/app/start-schedulers.ts` — is completely FROZEN.
 * Both artifacts run in parallel for the SAME ended shift session:
 * R-SH-F1 continues to auto-publish a `vt_shift_handover` row exactly as
 * today, AND this worker independently stages a `shift_handover_draft`
 * `action_proposal` for the same session. Neither reads nor writes the
 * other's table; there is no shared mutable state and no race. The §0(c)
 * per-org cutover (policy key `autopilot.policy_enforce.shift_handover_draft.
 * <clinicId>`, skipping `scanEndedShiftsForHandover` for an opted-in clinic,
 * auto-publish-on-timeout, the `auto_published_on_timeout` audit kind) is a
 * SEPARATE follow-up slice scheduled after the §6 approval-queue UI ships —
 * NONE of that is built here.
 *
 * Content source: the SAME functions R-SH-F1 uses —
 * `resolveShiftWindow` (already exported) + `aggregateDeltas` (now exported,
 * per this slice's one sanctioned keyword change to
 * `shift-handover-generator.ts`) — both in `server/lib/shift-handover-generator.ts`.
 *
 * Scan shape mirrors `scanEndedShiftsForHandover`
 * (`server/lib/shift-handover-scheduler.ts:23`) exactly: recently-ended
 * `vt_shift_sessions` rows in a lookback window over `endedAt`. That file is
 * READ-ONLY reused here (never modified) — this worker's scan query is a
 * separate, independent implementation of the same shape, not an import,
 * because the scheduler's scan function is private and this slice's only
 * sanctioned change to that file's sibling
 * (`shift-handover-generator.ts`) is the `aggregateDeltas` export.
 *
 * Cadence: every 10 minutes (`AUTOPILOT_HANDOVER_DRAFT_CRON`), R-SH-F1-
 * adjacent — R-SH-F1's own scheduler runs every 5 minutes with a 15-minute
 * (3x) lookback; this worker uses a 10-minute interval with a 30-minute (3x)
 * lookback, the same safety-margin ratio, deliberately slower than R-SH-F1
 * itself since staging a shadow proposal is not on the critical path R-SH-F1
 * already covers unconditionally — see `server/workers/
 * autopilotCoordinatorReassignWorker.ts`'s 15-minute conservative cadence for
 * the sibling precedent this mirrors (a shift-end-adjacent, but not
 * per-minute-critical, signal).
 *
 * Idempotency: `sourceSessionId = shiftSessions.id` — a repeat scan of the
 * same `(clinicId, "shift_handover_draft", sessionId)` triple is a no-op via
 * `stageProposal` -> `ActionProposalWriter.stage`'s unique-index semantics
 * (`StageOutcome.created` gates the audit/metric emission — the §3-review
 * fix this pattern was hardened around). A rejected proposal suppresses
 * re-proposal for that session (noise discipline, same pattern as every
 * other kind — not a bug to "fix" later).
 *
 * R-SH-F1 PARITY on empty deltas: this worker NEVER skips a candidate
 * session for having zero deltas — `composeHandoverDraftProposal` composes
 * (and this worker stages) a valid proposal even for a quiet shift, mirroring
 * `generateShiftHandover`'s own unconditional-insert behavior (see the
 * composer's header doc). Unlike the signal-detection kinds (§3-§5), this
 * kind is NOT gated on a detected signal — it fires for every ended session.
 *
 * Locale: like the restock/crash-cart proposals, a shift-handover proposal is
 * shift-wide (reviewed via the approval-queue surface), not a per-user push
 * — uses `INITIAL_LOCALE` (Hebrew, "unauth/broadcast paths" constant), not a
 * per-user resolution. This differs from R-SH-F1's OWN push notification
 * (`defaultEnqueueHandoverPush`, per-recipient `preferredLocale`) because
 * that is a targeted push to individual users, while this proposal's summary
 * is read by whoever opens the approval queue.
 */
import { and, gte, isNotNull, lt } from "drizzle-orm";
import { Queue, Worker, type JobsOptions } from "bullmq";
import { db, shiftSessions } from "../db.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import { createRedisConnection } from "../lib/redis.js";
import { resolveShiftWindow, aggregateDeltas, type ShiftWindow } from "../lib/shift-handover-generator.js";
import type { ShiftHandoverDeltas } from "../lib/shift-handover.js";
import { composeHandoverDraftProposal } from "../lib/autopilot/handover-draft-composer.js";
import { stageProposal } from "../lib/autopilot/action-proposal-service.js";
import {
  DrizzleActionProposalWriter,
  type ActionProposalWriter,
} from "../lib/autopilot/action-proposal-writer.port.js";

const SYSTEM_USER_ID = "system:autopilot-handover-draft";
const SYSTEM_USER_EMAIL = "autopilot-handover-draft@vettrack.system";

export const AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME = "autopilot-handover-draft";
export const AUTOPILOT_HANDOVER_DRAFT_JOB_NAME = "scan-handover-draft";
export const AUTOPILOT_HANDOVER_DRAFT_CRON = "*/10 * * * *"; // every 10 min — R-SH-F1-adjacent (see header doc)
export const AUTOPILOT_HANDOVER_DRAFT_REPEAT_JOB_ID = "repeat-autopilot-handover-draft";
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
/** 3x the scan interval, same safety-margin ratio as `shift-handover-scheduler.ts`'s 5min/15min pair. */
const LOOKBACK_MS = 30 * 60 * 1000;

export interface EndedSessionCandidate {
  id: string;
  clinicId: string;
}

/**
 * Mirrors `scanEndedShiftsForHandover`'s query shape exactly (same lookback
 * window over `shiftSessions.endedAt`, same `isNotNull` + `gte`/`lt` guard) —
 * an independent implementation, not an import, per this file's header doc.
 */
async function findRecentlyEndedSessions(now: Date): Promise<EndedSessionCandidate[]> {
  const nowMs = now.getTime();
  const since = new Date(nowMs - LOOKBACK_MS);
  const until = new Date(nowMs);

  const rows = await db
    .select({ id: shiftSessions.id, clinicId: shiftSessions.clinicId })
    .from(shiftSessions)
    .where(
      and(
        isNotNull(shiftSessions.endedAt),
        gte(shiftSessions.endedAt, since),
        lt(shiftSessions.endedAt, until),
      ),
    );

  return rows;
}

export interface HandoverDraftScanDeps {
  writer: ActionProposalWriter;
  findRecentlyEndedSessions: (now: Date) => Promise<EndedSessionCandidate[]>;
  resolveWindow: (clinicId: string, sessionId: string) => Promise<ShiftWindow>;
  /** Takes the ALREADY-RESOLVED window (not re-resolved) — avoids a duplicate `resolveShiftWindow` DB round-trip. */
  readDeltas: (clinicId: string, window: ShiftWindow) => Promise<ShiftHandoverDeltas>;
}

export interface HandoverDraftScanResult {
  scanned: number;
  staged: number;
}

/**
 * Injectable-deps core scan (unit-testable without Redis/BullMQ/a real DB —
 * mirrors every sibling worker's `runX(now)` split). For every recently-ended
 * session, resolves its window + deltas via the SAME content source R-SH-F1
 * uses, composes a proposal (never gated on a signal — see header doc), and
 * stages it via the shared §1 `stageProposal` (which already audits +
 * increments metrics — no duplicate bookkeeping here).
 */
export async function runHandoverDraftScan(
  deps: HandoverDraftScanDeps,
  now = new Date(),
): Promise<HandoverDraftScanResult> {
  const candidates = await deps.findRecentlyEndedSessions(now);
  let staged = 0;

  for (const { id: sessionId, clinicId } of candidates) {
    const window = await deps.resolveWindow(clinicId, sessionId);
    const deltas = await deps.readDeltas(clinicId, window);

    const input = composeHandoverDraftProposal({ clinicId, shiftSessionId: sessionId, window, deltas, locale: INITIAL_LOCALE });

    const outcome = await stageProposal(
      { writer: deps.writer },
      {
        input,
        groundTruthFacts: input.citedFacts,
        stagedBy: { performedBy: SYSTEM_USER_ID, performedByEmail: SYSTEM_USER_EMAIL },
      },
    );

    if (outcome.created) staged++;
  }

  return { scanned: candidates.length, staged };
}

const AUTOPILOT_HANDOVER_DRAFT_JOB_OPTIONS: Pick<
  JobsOptions,
  "attempts" | "backoff" | "removeOnComplete" | "removeOnFail"
> = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

let handoverDraftQueueInitialized = false;

/** Real deps: `resolveShiftWindow` + `aggregateDeltas` (R-SH-F1's own content source) + `DrizzleActionProposalWriter`. */
function realScanDeps(): HandoverDraftScanDeps {
  return {
    writer: new DrizzleActionProposalWriter(),
    findRecentlyEndedSessions,
    resolveWindow: resolveShiftWindow,
    readDeltas: aggregateDeltas,
  };
}

export function startAutopilotHandoverDraftWorker(): void {
  if (handoverDraftQueueInitialized) return;
  handoverDraftQueueInitialized = true;

  void (async () => {
    let queue: Queue | null = null;
    let worker: Worker | null = null;
    try {
      const queueConnection = await createRedisConnection();
      const workerConnection = await createRedisConnection();

      if (!queueConnection || !workerConnection) {
        console.log("[autopilot-handover-draft] queue disabled (Redis unavailable) — falling back to setInterval");
        setInterval(() => {
          runHandoverDraftScan(realScanDeps()).catch((e) =>
            console.error("[autopilot-handover-draft] failed:", e),
          );
        }, SCAN_INTERVAL_MS);
        runHandoverDraftScan(realScanDeps()).catch((e) =>
          console.error("[autopilot-handover-draft] startup failed:", e),
        );
        return;
      }

      queue = new Queue(AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME, { connection: queueConnection });
      worker = new Worker(
        AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME,
        async (job) => {
          if (job.name !== AUTOPILOT_HANDOVER_DRAFT_JOB_NAME) return;
          await runHandoverDraftScan(realScanDeps());
        },
        { connection: workerConnection, concurrency: 1 },
      );

      worker.on("failed", (job, error) => {
        console.error("[autopilot-handover-draft] job failed", {
          jobId: job?.id,
          name: job?.name,
          message: error.message,
        });
      });

      await queue.add(
        AUTOPILOT_HANDOVER_DRAFT_JOB_NAME,
        {},
        {
          jobId: AUTOPILOT_HANDOVER_DRAFT_REPEAT_JOB_ID,
          repeat: { pattern: AUTOPILOT_HANDOVER_DRAFT_CRON },
          ...AUTOPILOT_HANDOVER_DRAFT_JOB_OPTIONS,
        },
      );

      console.log("[autopilot-handover-draft] scheduled via BullMQ", {
        queueName: AUTOPILOT_HANDOVER_DRAFT_QUEUE_NAME,
        cron: AUTOPILOT_HANDOVER_DRAFT_CRON,
      });

      runHandoverDraftScan(realScanDeps()).catch((e) =>
        console.error("[autopilot-handover-draft] startup scan failed:", e),
      );
    } catch (err) {
      console.error("[autopilot-handover-draft] startup failed — closing partial connections:", err);
      await worker?.close().catch(() => {});
      await queue?.close().catch(() => {});
      handoverDraftQueueInitialized = false;
    }
  })();
}

export const __test = {
  findRecentlyEndedSessions,
  SCAN_INTERVAL_MS,
  LOOKBACK_MS,
};
