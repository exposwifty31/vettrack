/**
 * VetTrack 2.0, Task 1.1 §5 — `crash_cart_drift` scan worker.
 *
 * Periodic scan: for every clinic with at least one active
 * `vt_crash_cart_items` row, reads the drift signal via
 * `CrashCartDriftReader` and stages a `crash_cart_drift` proposal when
 * either the missing-item or staleness signal is flagged. Mirrors
 * `autopilotRestockBurnWorker.ts`'s standalone Queue/Worker-per-file shape,
 * `runX(now)` + injectable-deps core + BullMQ wrapper split, `__test`
 * export, and `QUEUE_DISABLED_NO_REDIS` fallback.
 *
 * Cadence: daily, `30 6 * * *` — ahead of `autopilotRestockBurnWorker`'s
 * `0 7 * * *` slot (crash-cart readiness is a clinical-safety-adjacent
 * signal; scanning it before the restock scan is deliberate ordering, not
 * significant to the hour itself beyond staying clear of that slot).
 *
 * Idempotency: `sourceSessionId` is the scan date (`YYYY-MM-DD`). A repeat
 * scan of the same `(clinicId, "crash_cart_drift", scanDate)` triple is a
 * no-op via `stageProposal` → `ActionProposalWriter.stage` — one crash-cart
 * proposal per clinic per day; a rejection suppresses re-proposal for that
 * day (noise discipline, same pattern as the coordinator/restock workers —
 * not a bug to "fix" later).
 *
 * CLINICAL SAFETY: this worker only READS `vt_crash_cart_checks` /
 * `vt_crash_cart_items` and stages a shadow-mode approval-queue proposal.
 * It never touches Code Blue files, never pages/pushes/notifies anyone, and
 * never writes to `server/routes/crash-cart.ts` (read-only reference).
 *
 * Locale: like the restock proposal, a crash-cart proposal is clinic-wide,
 * not tied to one user — uses `INITIAL_LOCALE` (Hebrew, "unauth/broadcast
 * paths" constant), not a per-user resolution.
 */
import { eq } from "drizzle-orm";
import { Queue, Worker, type JobsOptions } from "bullmq";
import { db, crashCartItems } from "../db.js";
import { INITIAL_LOCALE } from "../../lib/i18n/types.js";
import { createRedisConnection } from "../lib/redis.js";
import { DrizzleCrashCartDriftReader, type CrashCartDriftReader } from "../lib/autopilot/crash-cart-drift-reader.port.js";
import { composeCrashCartDriftProposal } from "../lib/autopilot/crash-cart-drift-composer.js";
import { stageProposal } from "../lib/autopilot/action-proposal-service.js";
import {
  DrizzleActionProposalWriter,
  type ActionProposalWriter,
} from "../lib/autopilot/action-proposal-writer.port.js";

const SYSTEM_USER_ID = "system:autopilot-crash-cart-drift";
const SYSTEM_USER_EMAIL = "autopilot-crash-cart-drift@vettrack.system";

export const AUTOPILOT_CRASH_CART_DRIFT_QUEUE_NAME = "autopilot-crash-cart-drift";
export const AUTOPILOT_CRASH_CART_DRIFT_JOB_NAME = "scan-crash-cart-drift";
export const AUTOPILOT_CRASH_CART_DRIFT_CRON = "30 6 * * *"; // daily, ahead of autopilotRestockBurnWorker's 07:00 slot
export const AUTOPILOT_CRASH_CART_DRIFT_REPEAT_JOB_ID = "repeat-autopilot-crash-cart-drift";
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Distinct clinics with at least one active crash-cart item — mirrors `autopilotRestockBurnWorker.ts`'s `findCandidateClinics` narrowing (never an unbounded full-table scan). */
async function findCandidateClinics(): Promise<string[]> {
  const rows = await db
    .select({ clinicId: crashCartItems.clinicId })
    .from(crashCartItems)
    .where(eq(crashCartItems.active, true))
    .groupBy(crashCartItems.clinicId);
  return rows.map((row) => row.clinicId);
}

export interface CrashCartDriftScanDeps {
  reader: CrashCartDriftReader;
  writer: ActionProposalWriter;
  findCandidateClinics: (now: Date) => Promise<string[]>;
}

export interface CrashCartDriftScanResult {
  scanned: number;
  staged: number;
}

/** Injectable-deps core scan (unit-testable without Redis/BullMQ/a real DB — mirrors `runRestockBurnScan(now)`'s split). */
export async function runCrashCartDriftScan(
  deps: CrashCartDriftScanDeps,
  now = new Date(),
): Promise<CrashCartDriftScanResult> {
  const scanDate = toLocalDateString(now);
  const clinicIds = await deps.findCandidateClinics(now);
  let staged = 0;

  for (const clinicId of clinicIds) {
    const result = await deps.reader.read(clinicId, now);
    if (!result.missingItemsFlagged && !result.staleFlagged) continue;

    const input = composeCrashCartDriftProposal({ clinicId, scanDate, reader: result, locale: INITIAL_LOCALE });

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

  return { scanned: clinicIds.length, staged };
}

const AUTOPILOT_CRASH_CART_DRIFT_JOB_OPTIONS: Pick<
  JobsOptions,
  "attempts" | "backoff" | "removeOnComplete" | "removeOnFail"
> = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: 50,
  removeOnFail: 100,
};

let crashCartDriftQueueInitialized = false;

/** Real deps: `DrizzleCrashCartDriftReader` + `DrizzleActionProposalWriter` + `findCandidateClinics`. */
function realScanDeps(): CrashCartDriftScanDeps {
  return {
    reader: new DrizzleCrashCartDriftReader(),
    writer: new DrizzleActionProposalWriter(),
    findCandidateClinics,
  };
}

export function startAutopilotCrashCartDriftWorker(): void {
  if (crashCartDriftQueueInitialized) return;
  crashCartDriftQueueInitialized = true;

  void (async () => {
    let queue: Queue | null = null;
    let worker: Worker | null = null;
    try {
      const queueConnection = await createRedisConnection();
      const workerConnection = await createRedisConnection();

      if (!queueConnection || !workerConnection) {
        console.log("[autopilot-crash-cart-drift] queue disabled (Redis unavailable) — falling back to setInterval");
        setInterval(() => {
          runCrashCartDriftScan(realScanDeps()).catch((e) =>
            console.error("[autopilot-crash-cart-drift] failed:", e),
          );
        }, SCAN_INTERVAL_MS);
        runCrashCartDriftScan(realScanDeps()).catch((e) =>
          console.error("[autopilot-crash-cart-drift] startup failed:", e),
        );
        return;
      }

      queue = new Queue(AUTOPILOT_CRASH_CART_DRIFT_QUEUE_NAME, { connection: queueConnection });
      worker = new Worker(
        AUTOPILOT_CRASH_CART_DRIFT_QUEUE_NAME,
        async (job) => {
          if (job.name !== AUTOPILOT_CRASH_CART_DRIFT_JOB_NAME) return;
          await runCrashCartDriftScan(realScanDeps());
        },
        { connection: workerConnection, concurrency: 1 },
      );

      worker.on("failed", (job, error) => {
        console.error("[autopilot-crash-cart-drift] job failed", {
          jobId: job?.id,
          name: job?.name,
          message: error.message,
        });
      });

      await queue.add(
        AUTOPILOT_CRASH_CART_DRIFT_JOB_NAME,
        {},
        {
          jobId: AUTOPILOT_CRASH_CART_DRIFT_REPEAT_JOB_ID,
          repeat: { pattern: AUTOPILOT_CRASH_CART_DRIFT_CRON },
          ...AUTOPILOT_CRASH_CART_DRIFT_JOB_OPTIONS,
        },
      );

      console.log("[autopilot-crash-cart-drift] scheduled via BullMQ", {
        queueName: AUTOPILOT_CRASH_CART_DRIFT_QUEUE_NAME,
        cron: AUTOPILOT_CRASH_CART_DRIFT_CRON,
      });

      runCrashCartDriftScan(realScanDeps()).catch((e) =>
        console.error("[autopilot-crash-cart-drift] startup scan failed:", e),
      );
    } catch (err) {
      console.error("[autopilot-crash-cart-drift] startup failed — closing partial connections:", err);
      await worker?.close().catch(() => {});
      await queue?.close().catch(() => {});
      crashCartDriftQueueInitialized = false;
    }
  })();
}

export const __test = {
  findCandidateClinics,
  toLocalDateString,
  SCAN_INTERVAL_MS,
};
