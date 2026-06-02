import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, equipment } from "../db.js";

export type LinkedEquipmentItem = { id: string; name: string };

type LogEquipmentRef = {
  category: string;
  equipmentId: string | null;
};

/** Distinct equipment units referenced on a session's log (category equipment). */
export async function fetchLinkedEquipmentForSession(
  clinicId: string,
  logEntries: LogEquipmentRef[],
): Promise<LinkedEquipmentItem[]> {
  const ids = [
    ...new Set(
      logEntries
        .filter((e) => e.category === "equipment" && e.equipmentId)
        .map((e) => e.equipmentId as string),
    ),
  ];
  if (ids.length === 0) return [];

  return db
    .select({ id: equipment.id, name: equipment.name })
    .from(equipment)
    .where(
      and(
        eq(equipment.clinicId, clinicId),
        inArray(equipment.id, ids),
        isNull(equipment.deletedAt),
      ),
    );
}
