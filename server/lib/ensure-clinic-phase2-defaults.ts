import { db, users } from "../db.js";
import {
  seedContainersFromBlueprint,
  syncContainerTargetQuantitiesFromBlueprint,
} from "../services/inventory.service.js";

async function distinctClinicIds(): Promise<string[]> {
  const rows = await db.selectDistinct({ clinicId: users.clinicId }).from(users);
  return rows.map((r) => r.clinicId).filter(Boolean);
}

/**
 * Seeds the default ICU and internal-medicine containers when the clinic has none.
 * Returns how many rows were inserted.
 */
export async function seedDefaultContainersIfEmpty(clinicId: string): Promise<number> {
  return seedContainersFromBlueprint(clinicId);
}

export async function seedDefaultContainersForAllEmptyClinics(): Promise<void> {
  const ids = await distinctClinicIds();
  for (const clinicId of ids) {
    await seedDefaultContainersIfEmpty(clinicId);
  }
}

/** Run after migrations: optional container seed + blueprint target sync (billing catalog removed). */
export async function ensureClinicPhase2Defaults(): Promise<void> {
  await seedDefaultContainersForAllEmptyClinics();
  await syncContainerTargetQuantitiesFromBlueprint();
}

/** @deprecated Billing catalog seeding removed. */
export async function ensureDefaultBillingItemsForClinic(_clinicId: string): Promise<void> {
  return;
}

/** @deprecated Billing catalog seeding removed. */
export async function ensureDefaultBillingItemsForAllClinics(): Promise<void> {
  return;
}
