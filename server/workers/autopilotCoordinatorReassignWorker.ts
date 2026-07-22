/**
 * VetTrack 2.0, Task 1.1 §3 — `coordinator_reassign_off_roster` scan worker.
 *
 * Periodic scan for roster drift: for every (clinic, shiftDate) that has a
 * PERSISTED `vt_shift_equipment_coordinator` row, re-checks whether that
 * assignment is still on the fresh roster-derived candidate set
 * (`CoordinatorRosterReader`, §3) and stages a `coordinator_reassign_off_roster`
 * proposal when it isn't. Mirrors `server/workers/sweep-escalation.worker.ts`'s
 * standalone Queue/Worker-per-file shape, `runX(now)` + injectable-deps core +
 * BullMQ wrapper split, `__test` export, and `QUEUE_DISABLED_NO_REDIS`
 * fallback — that file itself is READ-ONLY reused (never modified) via the
 * shared `resolveShiftCoordinator` service call inside `CoordinatorRosterReader`.
 *
 * This is a DIFFERENT mechanism from the escalation ladder in
 * `sweep-escalation.worker.ts`: that worker answers "the Room Sweep isn't
 * done, who's on the hook now" (already automatic, already shipped, outside
 * this slice's scope); this worker answers "the assigned coordinator
 * appears to have left roster, should someone else be assigned." They are
 * not conflated and neither replaces the other.
 *
 * Idempotency: `stageProposal` → `ActionProposalWriter.stage` is a no-op on
 * a repeat `(clinicId, kind, sourceSessionId=shiftDate)` triple (the §1
 * unique index) — a second scan of the same shift date, or a scan after the
 * proposal was already decided (including REJECTED), never re-stages. A
 * rejected proposal deliberately suppresses re-proposal for that shift date
 * — noise discipline, not a bug to "fix" later.
 *
 * Cadence: every 15 minutes — this signal is not time-critical (unlike the
 * shift-end-driven escalation ladder), so a conservative interval is
 * deliberate, not a placeholder.
 */
import { and, eq, inArray } from "drizzle-orm";
import { Queue, Worker, type JobsOptions } from "bullmq";
import { db, shiftEquipmentCoordinator } from "../db.js";
import type { Locale } from "../../lib/i18n/types.js";
import { resolveUserLocale } from "../lib/resolve-user-locale.js";
import { createRedisConnection } from "../lib/redis.js";
import {
  DrizzleCoordinatorRosterReader,
  type CoordinatorRosterReader,
} from "../lib/autopilot/coordinator-roster-reader.port.js";
import { composeCoordinatorReassignProposal } from "../lib/autopilot/coordinator-reassign-composer.js";
import { stageProposal } from "../lib/autopilot/action-proposal-service.js";
import {
  DrizzleActionProposalWriter,
  type ActionProposalWriter,
} from "../lib/autopilot/action-proposal-writer.port.js";

const SYSTEM_USER_ID = "system:autopilot-coordinator-reassign";
const SYSTEM_USER_EMAIL = "autopilot-coordinator-reassign@vettrack.system";

export const AUTOPILOT_COORDINATOR_REASSIGN_QUEUE_NAME = "autopilot-coordinator-reassign";
export const AUTOPILOT_COORDINATOR_REASSIGN_JOB_NAME = "scan-coordinator-reassign";
export const AUTOPILOT_COORDINATOR_REASSIGN_CRON = "*/15 * * * *"; // every 15 min — deliberately conservative, not time-critical
export const AUTOPILOT_COORDINATOR_REASSIGN_REPEAT_JOB_ID = "repeat-autopilot-coordinator-reassign";
const SCAN_INTERVAL_MS = 15 * 60 * 1000;

interface CandidateShiftDate {
  clinicId: string;
  shiftDate: string;
}

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Distinct (clinic, shiftDate) pairs that have a PERSISTED coordinator
 * assignment for today or yesterday (mirrors the today/yesterday roster
 * window `sweep-escalation.worker.ts`'s own candidate scan uses). Only
 * dates with a persisted row can produce an off-roster signal at all (§3,
 * step 3: "no persisted row -> no signal"), so scanning exactly this set is
 * both correct and bounded — no unbounded full-table scan.
 */
async function findCandidateShiftDates(now: Date): Promise<CandidateShiftDate[]> {
  const currentDate = toLocalDateString(now);
  const previousDate = new Date(now);
  previousDate.setDate(now.getDate() - 1);
  const yesterday = toLocalDateString(previousDate);

  const rows = await db
    .select({ clinicId: shiftEquipmentCoordinator.clinicId, shiftDate: shiftEquipmentCoordinator.shiftDate })
    .from(shiftEquipmentCoordinator)
    .where(inArray(shiftEquipmentCoordinator.shiftDate, [currentDate, yesterday]));

  const seen = new Set<string>();
  const result: CandidateShiftDate[] = [];
  for (const row of rows) {
    const key = `${row.clinicId}:${row.shiftDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ clinicId: row.clinicId, shiftDate: row.shiftDate });
  }
  return result;
}

export interface CoordinatorReassignScanDeps {
  reader: CoordinatorRosterReader;
  writer: ActionProposalWriter;
  findCandidateShiftDates: (now: Date) => Promise<CandidateShiftDate[]>;
  resolveLocale: (clinicId: string, coordinatorUserId: string) => Promise<Locale>;
}

export interface CoordinatorReassignScanResult {
  scanned: number;
  staged: number;
}

/**
 * Injectable-deps core scan (unit-testable without Redis/BullMQ/a real DB —
 * mirrors `runSweepEscalation(now)`'s split). For every candidate
 * (clinic, shiftDate), reads the roster-drift signal and, if off-roster,
 * composes + stages a proposal via the shared §1 `stageProposal` (which
 * already audits + increments metrics — no duplicate bookkeeping here).
 */
export async function runCoordinatorReassignScan(
  deps: CoordinatorReassignScanDeps,
  now = new Date(),
): Promise<CoordinatorReassignScanResult> {
  const candidates = await deps.findCandidateShiftDates(now);
  let staged = 0;

  for (const { clinicId, shiftDate } of candidates) {
    const result = await deps.reader.read(clinicId, shiftDate);
    if (!result.offRoster || !result.persistedRow) continue;

    const locale = await deps.resolveLocale(clinicId, result.persistedRow.coordinatorUserId);
    const input = composeCoordinatorReassignProposal({ clinicId, shiftDate, reader: result, locale });

    const before = await deps.writer.findStaged(clinicId, { kind: "coordinator_reassign_off_roster" });
    const alreadyStaged = before.some((row) => row.sourceSessionId === shiftDate);

    await stageProposal(
      { writer: deps.writer },
      {
        input,
        groundTruthFacts: input.citedFacts,
        stagedBy: { performedBy: SYSTEM_USER_ID, performedByEmail: SYSTEM_USER_EMAIL },
      },
    );

    if (!alreadyStaged) staged++;
  }

  return { scanned: candidates.length, staged };
}

const AUTOPILOT_COORDINATOR_REASSIGN_JOB_OPTIONS: Pick<
  JobsOptions,
  "attempts" | "backoff" | "removeOnComplete" | "removeOnFail"
> = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

let coordinatorReassignQueueInitialized = false;

/** Real deps: `DrizzleCoordinatorRosterReader` + `DrizzleActionProposalWriter` + `resolveUserLocale`. */
function realScanDeps(): CoordinatorReassignScanDeps {
  return {
    reader: new DrizzleCoordinatorRosterReader(),
    writer: new DrizzleActionProposalWriter(),
    findCandidateShiftDates,
    resolveLocale: resolveUserLocale,
  };
}

export function startAutopilotCoordinatorReassignWorker(): void {
  if (coordinatorReassignQueueInitialized) return;
  coordinatorReassignQueueInitialized = true;

  void (async () => {
    let queue: Queue | null = null;
    let worker: Worker | null = null;
    try {
      const queueConnection = await createRedisConnection();
      const workerConnection = await createRedisConnection();

      if (!queueConnection || !workerConnection) {
        console.log(
          "[autopilot-coordinator-reassign] queue disabled (Redis unavailable) — falling back to setInterval",
        );
        setInterval(() => {
          runCoordinatorReassignScan(realScanDeps()).catch((e) =>
            console.error("[autopilot-coordinator-reassign] failed:", e),
          );
        }, SCAN_INTERVAL_MS);
        runCoordinatorReassignScan(realScanDeps()).catch((e) =>
          console.error("[autopilot-coordinator-reassign] startup failed:", e),
        );
        return;
      }

      queue = new Queue(AUTOPILOT_COORDINATOR_REASSIGN_QUEUE_NAME, { connection: queueConnection });
      worker = new Worker(
        AUTOPILOT_COORDINATOR_REASSIGN_QUEUE_NAME,
        async (job) => {
          if (job.name !== AUTOPILOT_COORDINATOR_REASSIGN_JOB_NAME) return;
          await runCoordinatorReassignScan(realScanDeps());
        },
        { connection: workerConnection, concurrency: 1 },
      );

      worker.on("failed", (job, error) => {
        console.error("[autopilot-coordinator-reassign] job failed", {
          jobId: job?.id,
          name: job?.name,
          message: error.message,
        });
      });

      await queue.add(
        AUTOPILOT_COORDINATOR_REASSIGN_JOB_NAME,
        {},
        {
          jobId: AUTOPILOT_COORDINATOR_REASSIGN_REPEAT_JOB_ID,
          repeat: { pattern: AUTOPILOT_COORDINATOR_REASSIGN_CRON },
          ...AUTOPILOT_COORDINATOR_REASSIGN_JOB_OPTIONS,
        },
      );

      console.log("[autopilot-coordinator-reassign] scheduled via BullMQ", {
        queueName: AUTOPILOT_COORDINATOR_REASSIGN_QUEUE_NAME,
        cron: AUTOPILOT_COORDINATOR_REASSIGN_CRON,
      });

      runCoordinatorReassignScan(realScanDeps()).catch((e) =>
        console.error("[autopilot-coordinator-reassign] startup scan failed:", e),
      );
    } catch (err) {
      console.error("[autopilot-coordinator-reassign] startup failed — closing partial connections:", err);
      await worker?.close().catch(() => {});
      await queue?.close().catch(() => {});
      coordinatorReassignQueueInitialized = false;
    }
  })();
}

export const __test = {
  findCandidateShiftDates,
  toLocalDateString,
  SCAN_INTERVAL_MS,
};
