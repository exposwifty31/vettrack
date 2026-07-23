/**
 * VetTrack 2.0, Task 1.1 §4 — `restock_po_on_burn` scan worker.
 *
 * Periodic scan: for every clinic with at least one active `vt_items` row
 * carrying a non-null `reorderPoint`, reads current on-hand (summed across
 * `vt_container_items`) via `RestockBurnReader` and stages a
 * `restock_po_on_burn` proposal when any item is at/below its reorder
 * point. Mirrors `autopilotCoordinatorReassignWorker.ts`'s standalone
 * Queue/Worker-per-file shape, `runX(now)` + injectable-deps core +
 * BullMQ wrapper split, `__test` export, and `QUEUE_DISABLED_NO_REDIS`
 * fallback.
 *
 * Cadence: daily, `0 7 * * *` — restock is not a per-minute operational
 * surface (mirrors `expiryCheckWorker`'s `0 8 * * *` daily-cron shape,
 * `server/workers/expiryCheckWorker.ts`; 07:00 chosen to run ahead of that
 * 08:00 slot rather than colliding with it — no other significance to the
 * hour itself).
 *
 * Idempotency: `sourceSessionId` is the scan date (`YYYY-MM-DD`, from the
 * `now` passed into the scan — deterministic in tests, real wall-clock
 * date in production). `stageProposal` → `ActionProposalWriter.stage` is a
 * no-op on a repeat `(clinicId, "restock_po_on_burn", scanDate)` triple —
 * one restock proposal per clinic per day; a rejection suppresses
 * re-proposal for that day (noise discipline, same as §3's coordinator
 * worker — not a bug to "fix" later).
 *
 * Locale: unlike the coordinator-reassign proposal (tied to a specific
 * stale coordinator's own `preferredLocale`), a restock proposal is
 * clinic-wide, not tied to one user. This uses `INITIAL_LOCALE`
 * (`lib/i18n/types.ts` — the existing constant for "unauth/broadcast
 * paths", Hebrew) rather than inventing a new per-clinic locale
 * resolution mechanism, which is out of scope for this slice.
 */
import { eq, and, isNotNull } from "drizzle-orm";
import { Queue, Worker, type JobsOptions } from "bullmq";
import { db, inventoryItems } from "../db.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import { createRedisConnection } from "../lib/redis.js";
import { DrizzleRestockBurnReader, type RestockBurnReader } from "../lib/autopilot/restock-burn-reader.port.js";
import { composeRestockPoProposal } from "../lib/autopilot/restock-po-composer.js";
import { stageProposal } from "../lib/autopilot/action-proposal-service.js";
import { notifyProposalQueueChanged } from "../lib/realtime-collab/proposal-queue-nudge.js";
import {
  DrizzleActionProposalWriter,
  type ActionProposalWriter,
} from "../lib/autopilot/action-proposal-writer.port.js";

const SYSTEM_USER_ID = "system:autopilot-restock-burn";
const SYSTEM_USER_EMAIL = "autopilot-restock-burn@vettrack.system";

export const AUTOPILOT_RESTOCK_BURN_QUEUE_NAME = "autopilot-restock-burn";
export const AUTOPILOT_RESTOCK_BURN_JOB_NAME = "scan-restock-burn";
export const AUTOPILOT_RESTOCK_BURN_CRON = "0 7 * * *"; // daily, ahead of expiryCheckWorker's 08:00 slot
export const AUTOPILOT_RESTOCK_BURN_REPEAT_JOB_ID = "repeat-autopilot-restock-burn";
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Distinct clinics with at least one active, reorder-point-tracked item —
 * only clinics with a possible signal source are scanned (mirrors the
 * coordinator worker's candidate-narrowing, and `expiryCheckWorker`'s
 * `fetchClinicsWithExpiringEquipment` groupBy-clinic pattern), never an
 * unbounded full-table scan.
 */
async function findCandidateClinics(): Promise<string[]> {
  const rows = await db
    .select({ clinicId: inventoryItems.clinicId })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.isActive, true), isNotNull(inventoryItems.reorderPoint)))
    .groupBy(inventoryItems.clinicId);
  return rows.map((row) => row.clinicId);
}

export interface RestockBurnScanDeps {
  reader: RestockBurnReader;
  writer: ActionProposalWriter;
  findCandidateClinics: (now: Date) => Promise<string[]>;
}

export interface RestockBurnScanResult {
  scanned: number;
  staged: number;
}

/**
 * Injectable-deps core scan (unit-testable without Redis/BullMQ/a real DB
 * — mirrors `runCoordinatorReassignScan(now)`'s split). For every
 * candidate clinic, reads flagged items and, if any, composes + stages a
 * proposal via the shared §1 `stageProposal` (which already audits +
 * increments metrics — no duplicate bookkeeping here).
 */
export async function runRestockBurnScan(
  deps: RestockBurnScanDeps,
  now = new Date(),
): Promise<RestockBurnScanResult> {
  const scanDate = toLocalDateString(now);
  const clinicIds = await deps.findCandidateClinics(now);
  let staged = 0;

  for (const clinicId of clinicIds) {
    const result = await deps.reader.read(clinicId);
    const flaggedItems = result.items.filter((item) => item.flagged);
    if (flaggedItems.length === 0) continue;

    const input = composeRestockPoProposal({ clinicId, scanDate, flaggedItems, locale: INITIAL_LOCALE });

    const outcome = await stageProposal(
      { writer: deps.writer },
      {
        input,
        groundTruthFacts: input.citedFacts,
        stagedBy: { performedBy: SYSTEM_USER_ID, performedByEmail: SYSTEM_USER_EMAIL },
      },
    );

    if (outcome.created) {
      staged++;
      notifyProposalQueueChanged(clinicId); // Task 1.1 §1.5 — advisory, fire-and-forget
    }
  }

  return { scanned: clinicIds.length, staged };
}

const AUTOPILOT_RESTOCK_BURN_JOB_OPTIONS: Pick<
  JobsOptions,
  "attempts" | "backoff" | "removeOnComplete" | "removeOnFail"
> = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

let restockBurnQueueInitialized = false;

/** Real deps: `DrizzleRestockBurnReader` + `DrizzleActionProposalWriter` + `findCandidateClinics`. */
function realScanDeps(): RestockBurnScanDeps {
  return {
    reader: new DrizzleRestockBurnReader(),
    writer: new DrizzleActionProposalWriter(),
    findCandidateClinics,
  };
}

export function startAutopilotRestockBurnWorker(): void {
  if (restockBurnQueueInitialized) return;
  restockBurnQueueInitialized = true;

  void (async () => {
    let queue: Queue | null = null;
    let worker: Worker | null = null;
    try {
      const queueConnection = await createRedisConnection();
      const workerConnection = await createRedisConnection();

      if (!queueConnection || !workerConnection) {
        console.log("[autopilot-restock-burn] queue disabled (Redis unavailable) — falling back to setInterval");
        setInterval(() => {
          runRestockBurnScan(realScanDeps()).catch((e) => console.error("[autopilot-restock-burn] failed:", e));
        }, SCAN_INTERVAL_MS);
        runRestockBurnScan(realScanDeps()).catch((e) =>
          console.error("[autopilot-restock-burn] startup failed:", e),
        );
        return;
      }

      queue = new Queue(AUTOPILOT_RESTOCK_BURN_QUEUE_NAME, { connection: queueConnection });
      worker = new Worker(
        AUTOPILOT_RESTOCK_BURN_QUEUE_NAME,
        async (job) => {
          if (job.name !== AUTOPILOT_RESTOCK_BURN_JOB_NAME) return;
          await runRestockBurnScan(realScanDeps());
        },
        { connection: workerConnection, concurrency: 1 },
      );

      worker.on("failed", (job, error) => {
        console.error("[autopilot-restock-burn] job failed", {
          jobId: job?.id,
          name: job?.name,
          message: error.message,
        });
      });

      await queue.add(
        AUTOPILOT_RESTOCK_BURN_JOB_NAME,
        {},
        {
          jobId: AUTOPILOT_RESTOCK_BURN_REPEAT_JOB_ID,
          repeat: { pattern: AUTOPILOT_RESTOCK_BURN_CRON },
          ...AUTOPILOT_RESTOCK_BURN_JOB_OPTIONS,
        },
      );

      console.log("[autopilot-restock-burn] scheduled via BullMQ", {
        queueName: AUTOPILOT_RESTOCK_BURN_QUEUE_NAME,
        cron: AUTOPILOT_RESTOCK_BURN_CRON,
      });

      runRestockBurnScan(realScanDeps()).catch((e) =>
        console.error("[autopilot-restock-burn] startup scan failed:", e),
      );
    } catch (err) {
      console.error("[autopilot-restock-burn] startup failed — closing partial connections:", err);
      await worker?.close().catch(() => {});
      await queue?.close().catch(() => {});
      restockBurnQueueInitialized = false;
    }
  })();
}

export const __test = {
  findCandidateClinics,
  toLocalDateString,
  SCAN_INTERVAL_MS,
};
