import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  animals,
  billingItems,
  billingLedger,
  db,
  medTaskDoseEdits,
  medicationTasks,
  inventoryJobs,
  type MedicationTask,
} from "../db.js";
import { logAudit } from "../lib/audit.js";
import { postSystemMessage } from "../lib/shift-chat-presence.js";
import { inventoryDeductionQueue } from "../queues/inventory-deduction.queue.js";
import {
  calculateMedication,
  MedicationCalculationError,
  type CalculationResult,
  type MedicationCalculationInput,
} from "./medication-calculation.service.js";

export class MedTaskError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MedTaskError";
  }
}

export type MedTaskReasonType = "NEW" | "REPEAT" | "CORRECTION";

export interface CreateMedicationTaskInput {
  clinicId: string;
  animalId: string;
  drugId: string;
  route: string;
  calculationInput: Omit<MedicationCalculationInput, "clinicId" | "drugId">;
  overrideReason?: string | null;
  reasonType?: MedTaskReasonType | null;
  dueAt?: Date | null;
  createdBy: string;
  createdByEmail: string;
  actorRole?: string | null;
}

export interface CompleteMedicationTaskInput {
  taskId: string;
  userId: string;
  userEmail: string;
  clinicId: string;
  actorRole?: string | null;
  actualVolume: number;
  administeredAt?: Date | null;
}

/** Per-task soft lock duration (Fix E): 10 minutes. */
const IN_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;
/** Global stale sweep threshold: longer than per-clinic sweep. */
const STALE_IN_PROGRESS_MS = 30 * 60 * 1000;
/** Exclusive upper bound (ml) for administered volume. */
const MAX_EXCLUSIVE_VOLUME_ML = 100;
const VALID_ROUTES = ["IV", "IM", "PO", "SC"] as const;

function isPostgresUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const o = err as { code?: string; cause?: { code?: string } };
  return o.code === "23505" || o.cause?.code === "23505";
}

async function findOpenMedicationTaskDuplicate(params: {
  clinicId: string;
  animalId: string;
  drugId: string;
  route: string;
}): Promise<MedicationTask | null> {
  const [row] = await db
    .select()
    .from(medicationTasks)
    .where(
      and(
        eq(medicationTasks.clinicId, params.clinicId),
        eq(medicationTasks.animalId, params.animalId),
        eq(medicationTasks.drugId, params.drugId),
        eq(medicationTasks.route, params.route),
        inArray(medicationTasks.status, ["pending", "in_progress"]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Validate the actual administered volume supplied at completion time. */
function validateActualVolume(actualVolume: number): void {
  if (!Number.isFinite(actualVolume)) {
    throw new MedTaskError("VOLUME_INVALID", 400, "Administered volume is not a valid number.");
  }
  if (actualVolume <= 0) {
    throw new MedTaskError("VOLUME_OUT_OF_RANGE", 400, "Administered volume must be greater than 0 ml.");
  }
  if (actualVolume >= MAX_EXCLUSIVE_VOLUME_ML) {
    throw new MedTaskError("VOLUME_OUT_OF_RANGE", 400, "Administered volume must be less than 100 ml.");
  }
  const twoDp = Math.round(actualVolume * 100) / 100;
  if (Math.abs(twoDp - actualVolume) > 1e-6) {
    throw new MedTaskError("VOLUME_PRECISION", 400, "Administered volume must use at most two decimal places.");
  }
}

/** Build the canonical immutable snapshot stored at task creation. */
function buildSnapshot(
  result: CalculationResult,
  input: Pick<MedicationCalculationInput, "weightKg" | "prescribedDosePerKg" | "doseUnit">,
  concentrationMgPerMl: number,
): Record<string, unknown> {
  const doseMg =
    input.doseUnit === "direct_mg"
      ? input.prescribedDosePerKg
      : result.final.totalDoseMg;

  return {
    version: 1,
    weight: input.weightKg,
    concentration: concentrationMgPerMl,
    doseMg,
    calculatedVolume: result.final.calculatedVolume,
    calculationPath: result.breakdown.calculationPath,
    formularyId: result.formularyId ?? null,
    formularyVersion: result.formularyVersion ?? null,
    data: result,
  };
}

export async function createMedicationTask(input: CreateMedicationTaskInput): Promise<MedicationTask> {
  try {
    return await createMedicationTaskInner(input);
  } catch (err) {
    if (err instanceof MedTaskError) throw err;
    if (err instanceof MedicationCalculationError) throw err;
    console.error("[createMedicationTask] unexpected error", err);
    throw new MedTaskError("INTERNAL_ERROR", 500, "Failed to create medication task.");
  }
}

async function createMedicationTaskInner(input: CreateMedicationTaskInput): Promise<MedicationTask> {
  const normalizedRoute = input.route.trim().toUpperCase();
  if (!VALID_ROUTES.includes(normalizedRoute as (typeof VALID_ROUTES)[number])) {
    throw new MedTaskError("INVALID_ROUTE", 400, "Invalid route");
  }

  const trimmedOverrideReason = input.overrideReason?.trim() || null;
  if (trimmedOverrideReason && trimmedOverrideReason.length > 300) {
    throw new MedTaskError("REASON_TOO_LONG", 400, "Override reason too long");
  }

  const [animal] = await db
    .select({ id: animals.id })
    .from(animals)
    .where(and(eq(animals.id, input.animalId), eq(animals.clinicId, input.clinicId)))
    .limit(1);

  if (!animal) {
    throw new MedTaskError("ANIMAL_NOT_FOUND", 404, "Animal was not found for this clinic.");
  }

  const result: CalculationResult = await calculateMedication({
    clinicId: input.clinicId,
    drugId: input.drugId,
    ...input.calculationInput,
  });

  if (result.safety.level === "blocked") {
    throw new MedTaskError("DOSE_BLOCKED", 400, result.safety.warningMessage ?? "Dose is blocked by safety rules.");
  }

  if (result.safety.requiresReason && !trimmedOverrideReason) {
    throw new MedTaskError(
      "REASON_REQUIRED",
      400,
      result.safety.warningMessage ?? "Override reason is required for this dose.",
    );
  }

  // ── Duplicate handling (Fix D): reasonType-aware ──────────────────────────
  const reasonType = input.reasonType ?? "NEW";
  const existingTask = await findOpenMedicationTaskDuplicate({
    clinicId: input.clinicId,
    animalId: input.animalId,
    drugId: input.drugId,
    route: normalizedRoute,
  });

  if (existingTask && reasonType === "CORRECTION") {
    // CORRECTION: update active task fields, never touch snapshot
    const doseMg =
      input.calculationInput.doseUnit === "direct_mg"
        ? input.calculationInput.prescribedDosePerKg
        : result.final.totalDoseMg;

    const prevDoseMg =
      (() => {
        const snap = existingTask.calculationSnapshot as Record<string, unknown> | null;
        return typeof snap?.doseMg === "number" ? snap.doseMg : null;
      })();

    // Audit the dose change
    await db.insert(medTaskDoseEdits).values({
      id: randomUUID(),
      clinicId: input.clinicId,
      taskId: existingTask.id,
      previousDoseMg: String(prevDoseMg ?? 0),
      newDoseMg: String(doseMg),
      editedBy: input.createdBy,
      reason: trimmedOverrideReason,
      createdAt: new Date(),
    });

    logAudit({
      clinicId: input.clinicId,
      actionType: "medication_task_dose_corrected",
      performedBy: input.createdBy,
      performedByEmail: input.createdByEmail,
      actorRole: input.actorRole,
      targetId: existingTask.id,
      targetType: "medication_task",
      metadata: {
        previousDoseMg: prevDoseMg,
        newDoseMg: doseMg,
        overrideReason: trimmedOverrideReason,
      },
    });

    return existingTask;
  }

  if (existingTask && reasonType !== "CORRECTION") {
    // NEW or REPEAT: return details so caller/UI can decide
    throw new MedTaskError(
      "DUPLICATE_ACTIVE_MEDICATION_TASK",
      409,
      "An active medication task already exists for this patient, drug, and route.",
      { existingTaskId: existingTask.id, reasonType },
    );
  }

  // No duplicate — create new task
  const snapshot = buildSnapshot(
    result,
    input.calculationInput,
    result.breakdown.concentrationMgPerMl,
  );

  let row: MedicationTask | undefined;
  try {
    const inserted = await db
      .insert(medicationTasks)
      .values({
        id: randomUUID(),
        clinicId: input.clinicId,
        animalId: input.animalId,
        drugId: input.drugId,
        route: normalizedRoute,
        calculationSnapshot: snapshot,
        safetyLevel: result.safety.level,
        overrideReason: trimmedOverrideReason,
        status: "pending",
        dueAt: input.dueAt ?? null,
        createdBy: input.createdBy,
        formularyId: result.formularyId ?? null,
        formularyVersion: result.formularyVersion ?? null,
      })
      .returning();
    row = inserted[0];
  } catch (err) {
    if (isPostgresUniqueViolation(err)) {
      const dup = await findOpenMedicationTaskDuplicate({
        clinicId: input.clinicId,
        animalId: input.animalId,
        drugId: input.drugId,
        route: normalizedRoute,
      });
      if (dup) {
        throw new MedTaskError(
          "DUPLICATE_ACTIVE_MEDICATION_TASK",
          409,
          "An active medication task already exists for this patient, drug, and route.",
          { existingTaskId: dup.id },
        );
      }
    }
    throw err;
  }

  if (!row) {
    throw new MedTaskError("TASK_CREATE_FAILED", 500, "Failed to create medication task.");
  }

  logAudit({
    clinicId: input.clinicId,
    actionType: "medication_task_created",
    performedBy: input.createdBy,
    performedByEmail: input.createdByEmail,
    actorRole: input.actorRole,
    targetId: row.id,
    targetType: "medication_task",
    metadata: {
      animalId: row.animalId,
      drugId: row.drugId,
      route: row.route,
      safetyLevel: row.safetyLevel,
      overrideReason: row.overrideReason,
      reasonType,
      dueAt: row.dueAt?.toISOString() ?? null,
    },
  });

  if (row.safetyLevel === "critical") {
    postSystemMessage(input.clinicId, "med_critical", {
      animalId: input.animalId,
      drugId: input.drugId,
    }).catch(() => {});
  }

  return row;
}

export async function takeMedicationTask(
  taskId: string,
  userId: string,
  userEmail: string,
  clinicId: string,
  actorRole?: string | null,
): Promise<MedicationTask> {
  try {
    const rows = await db
      .update(medicationTasks)
      .set({
        status: "in_progress",
        assignedTo: userId,
        startedAt: new Date(),
      })
      .where(
        and(
          eq(medicationTasks.id, taskId),
          eq(medicationTasks.clinicId, clinicId),
          eq(medicationTasks.status, "pending"),
          isNull(medicationTasks.assignedTo),
          isNull(medicationTasks.completedAt),
        ),
      )
      .returning();

    if (rows.length === 0) {
      throw new MedTaskError("TASK_ALREADY_TAKEN", 409, "Task is not available to be taken.");
    }

    const task = rows[0];
    logAudit({
      clinicId: task.clinicId,
      actionType: "medication_task_taken",
      performedBy: userId,
      performedByEmail: userEmail,
      actorRole,
      targetId: task.id,
      targetType: "medication_task",
      metadata: {
        animalId: task.animalId,
        drugId: task.drugId,
        route: task.route,
        status: task.status,
      },
    });
    return task;
  } catch (err) {
    if (err instanceof MedTaskError) throw err;
    console.error("[takeMedicationTask] unexpected error", err);
    throw new MedTaskError("INTERNAL_ERROR", 500, "Failed to take medication task.");
  }
}

/**
 * Complete a medication task.
 *
 * Fix F (approved): strictly atomic + idempotent.
 *   1. Validate actualVolume.
 *   2. DB transaction: insert billing ledger row (deterministic key) +
 *      update task (status=completed, actualVolume, administeredAt, inventoryStatus=PENDING).
 *      If billing insert fails → transaction rolls back; task remains in_progress.
 *   3. After commit: enqueue BullMQ inventory deduction job.
 */
export async function completeMedicationTask(input: CompleteMedicationTaskInput): Promise<MedicationTask> {
  const { taskId, userId, userEmail, clinicId, actorRole, actualVolume, administeredAt } = input;
  try {
    validateActualVolume(actualVolume);

    const completedTask = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(medicationTasks)
        .where(and(eq(medicationTasks.id, taskId), eq(medicationTasks.clinicId, clinicId)))
        .limit(1);

      if (!existing) {
        throw new MedTaskError("NOT_FOUND", 404, "Medication task was not found.");
      }
      if (existing.status === "completed") {
        throw new MedTaskError("TASK_ALREADY_COMPLETED", 409, "Task is already completed.");
      }
      if (existing.status === "cancelled") {
        throw new MedTaskError("TASK_CANCELLED", 409, "Task has been cancelled.");
      }
      if (existing.status !== "in_progress") {
        throw new MedTaskError("INVALID_STATE", 409, "Task must be in progress to complete.");
      }
      if (existing.assignedTo !== userId) {
        throw new MedTaskError("NOT_ASSIGNED_USER", 403, "Only the assigned user can complete this task.");
      }
      if (existing.completedAt) {
        throw new MedTaskError("TASK_ALREADY_COMPLETED", 409, "Task is already completed.");
      }

      // Insert billing ledger row with deterministic idempotency key
      const billingIdempotencyKey = `med-task-complete:${taskId}`;
      const [existingBilling] = await tx
        .select({ id: billingLedger.id })
        .from(billingLedger)
        .where(
          and(
            eq(billingLedger.clinicId, clinicId),
            eq(billingLedger.idempotencyKey, billingIdempotencyKey),
          ),
        )
        .limit(1);

      let billingId: string;
      if (existingBilling) {
        billingId = existingBilling.id;
      } else {
        const [defaultBillingItem] = await tx
          .select({ id: billingItems.id, unitPriceCents: billingItems.unitPriceCents })
          .from(billingItems)
          .where(and(eq(billingItems.clinicId, clinicId), eq(billingItems.code, "DEFAULT_MEDICATION")))
          .limit(1);

        const unitPrice = defaultBillingItem?.unitPriceCents ?? 0;
        billingId = randomUUID();
        await tx.insert(billingLedger).values({
          id: billingId,
          clinicId,
          animalId: existing.animalId,
          itemType: "CONSUMABLE",
          itemId: existing.drugId,
          quantity: 1,
          unitPriceCents: unitPrice,
          totalAmountCents: unitPrice,
          idempotencyKey: billingIdempotencyKey,
          status: "pending",
          entryType: "CHARGE",
          sourceType: "TASK",
          taskId,
          createdBy: userId,
          formularyId: existing.formularyId ?? null,
          formularyVersion: existing.formularyVersion ?? null,
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(medicationTasks)
        .set({
          status: "completed",
          completedAt: now,
          actualVolume: String(actualVolume),
          administeredAt: administeredAt ?? now,
          inventoryStatus: "PENDING",
        })
        .where(
          and(
            eq(medicationTasks.id, taskId),
            eq(medicationTasks.clinicId, clinicId),
            eq(medicationTasks.status, "in_progress"),
            eq(medicationTasks.assignedTo, userId),
            isNull(medicationTasks.completedAt),
          ),
        )
        .returning();

      if (!updated) {
        throw new MedTaskError("INVALID_STATE", 409, "Task state changed during completion. Please retry.");
      }

      return updated;
    });

    logAudit({
      clinicId,
      actionType: "medication_task_completed",
      performedBy: userId,
      performedByEmail: userEmail,
      actorRole,
      targetId: completedTask.id,
      targetType: "medication_task",
      metadata: {
        animalId: completedTask.animalId,
        drugId: completedTask.drugId,
        route: completedTask.route,
        actualVolume,
        administeredAt: (administeredAt ?? completedTask.completedAt)?.toISOString() ?? null,
        safetyLevel: completedTask.safetyLevel,
      },
    });

    // Enqueue inventory deduction job after commit (async, non-blocking)
    try {
      const snap = completedTask.calculationSnapshot as Record<string, unknown> | null;
      const calcVolume =
        typeof (snap as Record<string, unknown> | null)?.calculatedVolume === "number"
          ? ((snap as Record<string, unknown>).calculatedVolume as number)
          : actualVolume;

      const jobId = randomUUID();
      await db.insert(inventoryJobs).values({
        id: jobId,
        clinicId,
        taskId: completedTask.id,
        containerId: completedTask.drugId, // placeholder; worker resolves actual container
        requiredVolumeMl: String(calcVolume),
        animalId: completedTask.animalId,
        status: "pending",
        retryCount: 0,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        resolvedAt: null,
      }).onConflictDoNothing();

      await inventoryDeductionQueue.add({
        taskId: completedTask.id,
        containerId: completedTask.drugId,
        requiredVolumeMl: calcVolume,
        clinicId,
        animalId: completedTask.animalId,
      });
    } catch (err) {
      // Enqueue failure is non-fatal — recovery job will pick it up
      console.error("[completeMedicationTask] inventory job enqueue failed", {
        taskId: completedTask.id,
        err: err instanceof Error ? err.message : String(err),
      });
      // Mark inventoryStatus=FAILED so it's visible immediately
      await db
        .update(medicationTasks)
        .set({ inventoryStatus: "FAILED" })
        .where(and(eq(medicationTasks.id, taskId), eq(medicationTasks.clinicId, clinicId)));
    }

    return completedTask;
  } catch (err) {
    if (err instanceof MedTaskError) throw err;
    console.error("[completeMedicationTask] unexpected error", err);
    throw new MedTaskError("INTERNAL_ERROR", 500, "Failed to complete task. Please retry.");
  }
}

export async function cancelMedicationTask(
  taskId: string,
  userId: string,
  userEmail: string,
  clinicId: string,
  actorRole?: string | null,
  reason?: string | null,
): Promise<MedicationTask> {
  try {
    const rows = await db
      .update(medicationTasks)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: userId,
        assignedTo: null,
      })
      .where(
        and(
          eq(medicationTasks.id, taskId),
          eq(medicationTasks.clinicId, clinicId),
          inArray(medicationTasks.status, ["pending", "in_progress"]),
          isNull(medicationTasks.completedAt),
        ),
      )
      .returning();

    if (rows.length === 0) {
      const [existing] = await db
        .select({ status: medicationTasks.status })
        .from(medicationTasks)
        .where(and(eq(medicationTasks.id, taskId), eq(medicationTasks.clinicId, clinicId)))
        .limit(1);
      if (!existing) throw new MedTaskError("NOT_FOUND", 404, "Medication task not found.");
      throw new MedTaskError("INVALID_STATE", 409, `Cannot cancel task with status '${existing.status}'.`);
    }

    const task = rows[0];
    logAudit({
      clinicId,
      actionType: "medication_task_cancelled",
      performedBy: userId,
      performedByEmail: userEmail,
      actorRole,
      targetId: task.id,
      targetType: "medication_task",
      metadata: { reason: reason ?? null, previousAssignee: task.assignedTo },
    });
    return task;
  } catch (err) {
    if (err instanceof MedTaskError) throw err;
    console.error("[cancelMedicationTask] unexpected error", err);
    throw new MedTaskError("INTERNAL_ERROR", 500, "Failed to cancel task.");
  }
}

export async function releaseExpiredMedicationTasks(clinicId?: string): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - IN_PROGRESS_TIMEOUT_MS);
    const whereExpr = clinicId
      ? and(
          eq(medicationTasks.status, "in_progress"),
          lt(medicationTasks.startedAt, cutoff),
          eq(medicationTasks.clinicId, clinicId),
          isNull(medicationTasks.completedAt),
        )
      : and(
          eq(medicationTasks.status, "in_progress"),
          lt(medicationTasks.startedAt, cutoff),
          isNull(medicationTasks.completedAt),
        );

    const released = await db
      .update(medicationTasks)
      .set({
        status: "pending",
        assignedTo: null,
        startedAt: null,
      })
      .where(whereExpr)
      .returning({
        id: medicationTasks.id,
        clinicId: medicationTasks.clinicId,
        assignedTo: medicationTasks.assignedTo,
      });

    for (const row of released) {
      logAudit({
        clinicId: row.clinicId,
        actionType: "medication_task_released_stale",
        performedBy: row.assignedTo ?? "system",
        performedByEmail: "",
        actorRole: "system",
        targetId: row.id,
        targetType: "medication_task",
        metadata: {
          reason: "in_progress_timeout",
          timeoutMs: IN_PROGRESS_TIMEOUT_MS,
          previousAssignee: row.assignedTo,
        },
      });
    }

    return released.length;
  } catch (err) {
    console.error("[releaseExpiredMedicationTasks]", err);
    return 0;
  }
}

export async function releaseStaleMedicationTasks(): Promise<number> {
  try {
    const released = await db
      .update(medicationTasks)
      .set({
        status: "pending",
        assignedTo: null,
        startedAt: null,
      })
      .where(
        and(
          eq(medicationTasks.status, "in_progress"),
          lt(medicationTasks.startedAt, new Date(Date.now() - STALE_IN_PROGRESS_MS)),
          isNull(medicationTasks.completedAt),
        ),
      )
      .returning({
        id: medicationTasks.id,
        clinicId: medicationTasks.clinicId,
        assignedTo: medicationTasks.assignedTo,
      });

    for (const row of released) {
      logAudit({
        clinicId: row.clinicId,
        actionType: "medication_task_released_stale",
        performedBy: row.assignedTo ?? "system",
        performedByEmail: "",
        actorRole: "system",
        targetId: row.id,
        targetType: "medication_task",
        metadata: {
          reason: "global_stale_sweep",
          previousAssignee: row.assignedTo,
        },
      });
    }

    return released.length;
  } catch (err) {
    console.error("[releaseStaleMedicationTasks]", err);
    return 0;
  }
}

export async function listMedicationTasks(clinicId: string): Promise<MedicationTask[]> {
  try {
    return await db
      .select()
      .from(medicationTasks)
      .where(
        and(
          eq(medicationTasks.clinicId, clinicId),
          inArray(medicationTasks.status, ["pending", "in_progress"]),
        ),
      );
  } catch (err) {
    console.error("[listMedicationTasks] unexpected error", err);
    throw new MedTaskError("INTERNAL_ERROR", 500, "Failed to list medication tasks.");
  }
}

/** Called by the inventory deduction worker after job outcome. */
export async function updateMedicationTaskInventoryStatus(
  taskId: string,
  clinicId: string,
  inventoryStatus: "SUCCESS" | "FAILED",
  inventoryMismatch?: boolean,
): Promise<void> {
  await db
    .update(medicationTasks)
    .set({
      inventoryStatus,
      inventoryMismatch: inventoryMismatch ?? false,
    })
    .where(and(eq(medicationTasks.id, taskId), eq(medicationTasks.clinicId, clinicId)));
}
