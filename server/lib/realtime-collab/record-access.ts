/**
 * R-RTC-1.1/1.4 — default record-level ACL for record-room joins.
 *
 * Co-presence record rooms (`clinic:<id>:record:<type>:<id>`) require the same
 * clinic-scoped access the REST record path enforces: the record must exist AND
 * belong to the joiner's clinic. This is the tenancy floor (clinicId is on every
 * table); a same-clinic record the user cannot see never leaks a room because the
 * existence check is clinic-scoped. Injectable so tests stub it and a stricter
 * per-record role rule can be layered later.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../../db.js";
import { equipment } from "../../schema/equipment.js";
import { rooms as roomsTable } from "../../schema/equipment.js";
import { appointments } from "../../schema/tasks.js";
import type { CollabIdentity, RecordType, RecordAccessCheck } from "./rooms.js";

async function existsInClinic(
  table: typeof equipment | typeof roomsTable | typeof appointments,
  id: string,
  clinicId: string,
): Promise<boolean> {
  const found = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.clinicId, clinicId)))
    .limit(1);
  return found.length > 0;
}

export const defaultRecordAccessCheck: RecordAccessCheck = async (
  identity: CollabIdentity,
  type: RecordType,
  id: string,
): Promise<boolean> => {
  switch (type) {
    case "equipment":
      return existsInClinic(equipment, id, identity.clinicId);
    case "task":
      return existsInClinic(appointments, id, identity.clinicId);
    case "room":
      return existsInClinic(roomsTable, id, identity.clinicId);
    default:
      return false;
  }
};
