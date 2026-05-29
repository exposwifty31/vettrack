import { and, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import {
  animals,
  appointments,
  billingLedger,
  db,
  dispenseEvents,
  hospitalizations,
  inventoryJobs,
  medicationTasks,
  shiftPatientHandoffItems,
} from "../db.js";
import { logAudit } from "../lib/audit.js";
import { PURGE_AFTER_DAYS } from "../lib/retention-policy.js";
import { releaseProcedureBoundEquipment } from "./equipment-operational-state.service.js";

const PURGE_AFTER_MS = PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;

const OPEN_TASK_STATUSES = ["pending", "assigned", "scheduled", "arrived", "approved", "in_progress"] as const;

export class PatientDeleteBlockedError extends Error {
  readonly blockingConditions: Array<{ type: string; ids: string[] }>;

  constructor(blockingConditions: Array<{ type: string; ids: string[] }>) {
    super("BLOCKING_CONDITIONS_PREVENT_DISCHARGE");
    this.name = "PatientDeleteBlockedError";
    this.blockingConditions = blockingConditions;
  }
}

/** Clears soft-delete when the animal returns to active clinical use. */
export async function restoreAnimalIfSoftDeleted(clinicId: string, animalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: animals.id, deletedAt: animals.deletedAt })
    .from(animals)
    .where(and(eq(animals.id, animalId), eq(animals.clinicId, clinicId)))
    .limit(1);

  if (!row?.deletedAt) return false;

  await db
    .update(animals)
    .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
    .where(and(eq(animals.id, animalId), eq(animals.clinicId, clinicId)));

  return true;
}

async function collectDischargeBlockers(
  clinicId: string,
  hospitalizationId: string,
  animalId: string,
): Promise<Array<{ type: string; ids: string[] }>> {
  const blockingConditions: Array<{ type: string; ids: string[] }> = [];

  const openTasks = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        eq(appointments.hospitalizationId, hospitalizationId),
        inArray(appointments.status, [...OPEN_TASK_STATUSES]),
      ),
    );
  if (openTasks.length > 0) {
    blockingConditions.push({ type: "open_tasks", ids: openTasks.map((t) => t.id) });
  }

  const unresolvedDispenses = await db
    .select({ id: dispenseEvents.id })
    .from(dispenseEvents)
    .where(
      and(
        eq(dispenseEvents.clinicId, clinicId),
        eq(dispenseEvents.patientId, animalId),
        eq(dispenseEvents.status, "EMERGENCY_PENDING"),
      ),
    );
  if (unresolvedDispenses.length > 0) {
    blockingConditions.push({
      type: "unresolved_emergency_dispenses",
      ids: unresolvedDispenses.map((d) => d.id),
    });
  }

  const failedInventoryJobs = await db
    .select({ id: inventoryJobs.id })
    .from(inventoryJobs)
    .where(
      and(
        eq(inventoryJobs.clinicId, clinicId),
        eq(inventoryJobs.animalId, animalId),
        eq(inventoryJobs.status, "failed"),
      ),
    );
  if (failedInventoryJobs.length > 0) {
    blockingConditions.push({ type: "failed_inventory_jobs", ids: failedInventoryJobs.map((j) => j.id) });
  }

  return blockingConditions;
}

async function dischargeHospitalizationIfActive(
  clinicId: string,
  hospitalizationId: string,
  animalId: string,
  options: { override: boolean; overrideReason: string | null; dischargeNotes: string | null },
): Promise<void> {
  const [hosp] = await db
    .select({ id: hospitalizations.id, dischargedAt: hospitalizations.dischargedAt })
    .from(hospitalizations)
    .where(
      and(
        eq(hospitalizations.id, hospitalizationId),
        eq(hospitalizations.clinicId, clinicId),
        eq(hospitalizations.animalId, animalId),
      ),
    )
    .limit(1);

  if (!hosp || hosp.dischargedAt) return;

  if (!options.override) {
    const blockingConditions = await collectDischargeBlockers(clinicId, hospitalizationId, animalId);
    if (blockingConditions.length > 0) {
      throw new PatientDeleteBlockedError(blockingConditions);
    }
  } else if (!options.overrideReason) {
    throw new Error("OVERRIDE_REASON_REQUIRED");
  }

  const now = new Date();
  await db
    .update(hospitalizations)
    .set({
      dischargedAt: now,
      status: "discharged",
      dischargeNotes: options.dischargeNotes?.trim() || null,
      updatedAt: now,
    })
    .where(
      and(
        eq(hospitalizations.id, hospitalizationId),
        eq(hospitalizations.clinicId, clinicId),
        isNull(hospitalizations.dischargedAt),
      ),
    );

  void releaseProcedureBoundEquipment(clinicId, hospitalizationId);
}

/**
 * Ends active hospitalization (when needed), soft-deletes the animal, and schedules
 * hard purge after PURGE_AFTER_DAYS unless restored via re-admission or new clinical data.
 */
export async function softDeletePatientByHospitalization(params: {
  clinicId: string;
  hospitalizationId: string;
  performedBy: string;
  performedByEmail: string;
  actorRole: string | null;
  override?: boolean;
  overrideReason?: string | null;
  dischargeNotes?: string | null;
}): Promise<{ animalId: string; restored: false }> {
  const rows = await db
    .select({
      hospId: hospitalizations.id,
      animalId: hospitalizations.animalId,
      animalDeletedAt: animals.deletedAt,
    })
    .from(hospitalizations)
    .innerJoin(animals, eq(hospitalizations.animalId, animals.id))
    .where(
      and(
        eq(hospitalizations.id, params.hospitalizationId),
        eq(hospitalizations.clinicId, params.clinicId),
        eq(animals.clinicId, params.clinicId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error("HOSPITALIZATION_NOT_FOUND");
  }
  if (row.animalDeletedAt) {
    throw new Error("ANIMAL_ALREADY_DELETED");
  }

  await dischargeHospitalizationIfActive(params.clinicId, row.hospId, row.animalId, {
    override: params.override === true,
    overrideReason: params.overrideReason?.trim() ?? null,
    dischargeNotes: params.dischargeNotes ?? null,
  });

  const now = new Date();
  await db
    .update(animals)
    .set({
      deletedAt: now,
      deletedBy: params.performedBy,
      updatedAt: now,
    })
    .where(and(eq(animals.id, row.animalId), eq(animals.clinicId, params.clinicId)));

  logAudit({
    clinicId: params.clinicId,
    actionType: "animal_soft_deleted",
    performedBy: params.performedBy,
    performedByEmail: params.performedByEmail,
    actorRole: params.actorRole,
    targetId: row.animalId,
    targetType: "animal",
    metadata: {
      hospitalizationId: params.hospitalizationId,
      purgeAfterDays: PURGE_AFTER_DAYS,
      override: params.override === true,
      overrideReason: params.overrideReason?.trim() || null,
    },
  });

  return { animalId: row.animalId, restored: false };
}

async function animalHasPostDeleteActivity(
  clinicId: string,
  animalId: string,
  deletedAt: Date,
): Promise<boolean> {
  const [activeHosp] = await db
    .select({ id: hospitalizations.id })
    .from(hospitalizations)
    .where(
      and(
        eq(hospitalizations.clinicId, clinicId),
        eq(hospitalizations.animalId, animalId),
        isNull(hospitalizations.dischargedAt),
      ),
    )
    .limit(1);
  if (activeHosp) return true;

  const checks = await Promise.all([
    db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.animalId, animalId),
          gt(appointments.createdAt, deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: medicationTasks.id })
      .from(medicationTasks)
      .where(
        and(
          eq(medicationTasks.clinicId, clinicId),
          eq(medicationTasks.animalId, animalId),
          gt(medicationTasks.createdAt, deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: billingLedger.id })
      .from(billingLedger)
      .where(
        and(
          eq(billingLedger.clinicId, clinicId),
          eq(billingLedger.animalId, animalId),
          gt(billingLedger.createdAt, deletedAt),
        ),
      )
      .limit(1),
    db
      .select({ id: hospitalizations.id })
      .from(hospitalizations)
      .where(
        and(
          eq(hospitalizations.clinicId, clinicId),
          eq(hospitalizations.animalId, animalId),
          gt(hospitalizations.createdAt, deletedAt),
        ),
      )
      .limit(1),
  ]);

  return checks.some((rows) => rows.length > 0);
}

/** Returns animals soft-deleted longer than PURGE_AFTER_DAYS with no post-delete clinical activity. */
export async function countAnimalPurgeCandidates(): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS);
  const stale = await db
    .select({
      id: animals.id,
      clinicId: animals.clinicId,
      deletedAt: animals.deletedAt,
    })
    .from(animals)
    .where(and(isNotNull(animals.deletedAt), lt(animals.deletedAt, cutoff)));

  let count = 0;
  for (const row of stale) {
    if (!row.deletedAt) continue;
    const hasActivity = await animalHasPostDeleteActivity(row.clinicId, row.id, row.deletedAt);
    if (!hasActivity) count += 1;
  }
  return count;
}

async function hardDeleteAnimal(clinicId: string, animalId: string): Promise<void> {
  await db
    .delete(shiftPatientHandoffItems)
    .where(and(eq(shiftPatientHandoffItems.clinicId, clinicId), eq(shiftPatientHandoffItems.animalId, animalId)));

  await db.delete(animals).where(and(eq(animals.id, animalId), eq(animals.clinicId, clinicId)));
}

/**
 * Permanently removes soft-deleted animals past the retention window with no
 * re-admission or clinical writes since deletion.
 */
export async function purgeSoftDeletedAnimals(): Promise<{ purged: number; purgedAnimalIds: string[] }> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS);

  const stale = await db
    .select({
      id: animals.id,
      clinicId: animals.clinicId,
      name: animals.name,
      deletedAt: animals.deletedAt,
    })
    .from(animals)
    .where(and(isNotNull(animals.deletedAt), lt(animals.deletedAt, cutoff)));

  const candidates = [];
  for (const row of stale) {
    if (!row.deletedAt) continue;
    const hasActivity = await animalHasPostDeleteActivity(row.clinicId, row.id, row.deletedAt);
    if (!hasActivity) candidates.push(row);
  }

  if (candidates.length === 0) {
    return { purged: 0, purgedAnimalIds: [] };
  }

  const purgedAnimalIds: string[] = [];
  for (const candidate of candidates) {
    try {
      await hardDeleteAnimal(candidate.clinicId, candidate.id);
      purgedAnimalIds.push(candidate.id);
    } catch (err) {
      console.error(`[animal-purge] failed to purge animal ${candidate.id}`, err);
    }
  }

  if (purgedAnimalIds.length > 0) {
    const byClinic = new Map<string, string[]>();
    for (const c of candidates) {
      if (!purgedAnimalIds.includes(c.id)) continue;
      const list = byClinic.get(c.clinicId) ?? [];
      list.push(c.id);
      byClinic.set(c.clinicId, list);
    }

    for (const [clinicId, ids] of byClinic) {
      logAudit({
        clinicId,
        actionType: "animals_hard_purged",
        performedBy: "system",
        performedByEmail: "",
        actorRole: "system",
        targetType: "animal",
        metadata: {
          purgedCount: ids.length,
          purgeAfterDays: PURGE_AFTER_DAYS,
          purgedAnimalIds: ids,
        },
      });
    }

    console.log(
      `[animal-purge] hard-deleted ${purgedAnimalIds.length} animal(s) soft-deleted more than ${PURGE_AFTER_DAYS} days ago`,
    );
  }

  return { purged: purgedAnimalIds.length, purgedAnimalIds };
}
