import { sql } from "drizzle-orm";

/**
 * Room-to-animal linkage was removed in migration 142 (`vt_patient_room_assignments` dropped).
 * List/detail reads keep the response shape; values are always null until a new mapping exists.
 */
export const equipmentLinkedAnimalSelect = {
  linkedAnimalId: sql<string | null>`NULL`.as("linkedAnimalId"),
  linkedAnimalName: sql<string | null>`NULL`.as("linkedAnimalName"),
} as const;
