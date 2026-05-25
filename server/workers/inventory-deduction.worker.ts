import { and, eq, sql } from "drizzle-orm";
import { Worker } from "bullmq";
import { appointments, db, inventoryJobs } from "../db.js";
import { MAX_INVENTORY_JOB_RETRIES } from "../lib/inventory-constants.js";
import { createRedisConnection } from "../lib/redis.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import {
  INVENTORY_DEDUCTION_JOB_NAME,
  INVENTORY_DEDUCTION_QUEUE_NAME,
  type InventoryDeductionJobData,
} from "../queues/inventory-deduction.queue.js";
import { resolveMedicationTaskContainerId } from "../services/appointments.service.js";
import { deductMedicationInventoryInTx } from "../services/inventory.service.js";

let inventoryDeductionWorker: Worker<InventoryDeductionJobData> | null = null;
let inventoryDeductionWorkerInitialized = false;
let legacyWorkerStarterWarned = false;

const logger = {
  warn(message: string, meta: { name: string }): void {
    console.warn(message, meta);
  },
};

function warnLegacyWorkerStarterOnce(name: string): void {
  if (legacyWorkerStarterWarned) return;
  legacyWorkerStarterWarned = true;
  logger.warn("legacy_worker_starter_used", { name });
}

async function markResolved(claimedId: string, clinicId: string): Promise<void> {
  await db
    .update(inventoryJobs)
    .set({
      status: "resolved",
      failureReason: null,
      updatedAt: new Date(),
      resolvedAt: new Date(),
    })
    .where(and(eq(inventoryJobs.id, claimedId), eq(inventoryJobs.clinicId, clinicId)));
}

async function markFailed(claimedId: string, clinicId: string, failureReason: string): Promise<void> {
  await db
    .update(inventoryJobs)
    .set({
      status: "failed",
      failureReason,
      updatedAt: new Date(),
    })
    .where(and(eq(inventoryJobs.id, claimedId), eq(inventoryJobs.clinicId, clinicId)));
}

/** BullMQ processor — shared by legacy worker starter and {@link startJobRuntime}. */
export async function processInventoryDeductionJob(
  jobData: InventoryDeductionJobData,
): Promise<void> {
  const [claimed] = await db
    .update(inventoryJobs)
    .set({
      status: "processing",
      retryCount: sql`${inventoryJobs.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(inventoryJobs.taskId, jobData.taskId),
        eq(inventoryJobs.clinicId, jobData.clinicId),
        eq(inventoryJobs.status, "pending"),
      ),
    )
    .returning();

  if (!claimed) return;

  const [appointmentRow] = await db
    .select({
      id: appointments.id,
      clinicId: appointments.clinicId,
      vetId: appointments.vetId,
      containerId: appointments.containerId,
      metadata: appointments.metadata,
    })
    .from(appointments)
    .where(and(eq(appointments.id, claimed.taskId), eq(appointments.clinicId, claimed.clinicId)))
    .limit(1);

  if (!appointmentRow) {
    const failureReason = "TASK_NOT_FOUND";
    await markFailed(claimed.id, claimed.clinicId, failureReason);
    console.error(
      "[inventory-deduction] terminal failure",
      {
        taskId: claimed.taskId,
        containerId: claimed.containerId,
        clinicId: claimed.clinicId,
        retryCount: claimed.retryCount,
        failureReason,
      },
    );
    return;
  }

  const resolvedContainerId = resolveMedicationTaskContainerId(appointmentRow);
  if (!resolvedContainerId) {
    const failureReason = "CONTAINER_NOT_FOUND";
    await markFailed(claimed.id, claimed.clinicId, failureReason);
    console.error(
      "[inventory-deduction] terminal failure",
      {
        taskId: claimed.taskId,
        containerId: claimed.containerId,
        clinicId: claimed.clinicId,
        retryCount: claimed.retryCount,
        failureReason,
      },
    );
    return;
  }

  if (!appointmentRow.vetId) {
    const failureReason = "TASK_TECHNICIAN_MISSING";
    await markFailed(claimed.id, claimed.clinicId, failureReason);
    console.error(
      "[inventory-deduction] terminal failure",
      {
        taskId: claimed.taskId,
        containerId: claimed.containerId,
        clinicId: claimed.clinicId,
        retryCount: claimed.retryCount,
        failureReason,
      },
    );
    return;
  }

  try {
    const deductionResult = await db.transaction(async (tx) => {
      return deductMedicationInventoryInTx(tx, {
        clinicId: claimed.clinicId,
        containerId: resolvedContainerId,
        volumeMl: Number(claimed.requiredVolumeMl),
        actorUserId: appointmentRow.vetId!,
        taskId: claimed.taskId,
        animalId: claimed.animalId ?? null,
      });
    });

    if ("alreadyApplied" in deductionResult) {
      await markResolved(claimed.id, claimed.clinicId);
      return;
    }

    if ("error" in deductionResult) {
      const failureReason = deductionResult.error;
      await markFailed(claimed.id, claimed.clinicId, failureReason);
      console.error(
        "[inventory-deduction] terminal failure",
        {
          taskId: claimed.taskId,
          containerId: claimed.containerId,
          clinicId: claimed.clinicId,
          retryCount: claimed.retryCount,
          failureReason,
        },
      );
      return;
    }

    if ("ok" in deductionResult && deductionResult.quantityAfter === 0) {
      postSystemMessage(claimed.clinicId, "low_stock", {
        itemId: deductionResult.containerId,
      }).catch(() => {});
    }

    await markResolved(claimed.id, claimed.clinicId);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    if (claimed.retryCount >= MAX_INVENTORY_JOB_RETRIES) {
      await markFailed(claimed.id, claimed.clinicId, failureReason);
      console.error(
        "[inventory-deduction] terminal failure",
        {
          taskId: claimed.taskId,
          containerId: claimed.containerId,
          clinicId: claimed.clinicId,
          retryCount: claimed.retryCount,
          failureReason,
        },
      );
      return;
    }

    await db
      .update(inventoryJobs)
      .set({
        status: "pending",
        failureReason,
        updatedAt: new Date(),
      })
      .where(and(eq(inventoryJobs.id, claimed.id), eq(inventoryJobs.clinicId, claimed.clinicId)));

    throw error;
  }
}

/**
 * @deprecated Use Job Runtime registry execution instead.
 */
export async function startInventoryDeductionWorker(): Promise<void> {
  warnLegacyWorkerStarterOnce("startInventoryDeductionWorker");
  if (inventoryDeductionWorkerInitialized) return;
  const workerConnection = await createRedisConnection();
  if (!workerConnection) {
    console.warn("[inventory-deduction] worker disabled (Redis unavailable)");
    return;
  }

  inventoryDeductionWorker = new Worker<InventoryDeductionJobData>(
    INVENTORY_DEDUCTION_QUEUE_NAME,
    async (job) => {
      if (job.name !== INVENTORY_DEDUCTION_JOB_NAME) return;
      await processInventoryDeductionJob(job.data);
    },
    {
      connection: workerConnection,
      concurrency: 1,
    },
  );

  inventoryDeductionWorker.on("failed", (job, error) => {
    console.error("[inventory-deduction] worker job failed", {
      jobId: job?.id,
      name: job?.name,
      message: error.message,
    });
  });

  inventoryDeductionWorkerInitialized = true;
}
