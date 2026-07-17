import { equipment } from "../../db.js";
import { sql } from "drizzle-orm";

/** Advisory RFID doorway fields (read-only signal; never mutates authoritative roomId). */
export function equipmentRfidSelect(clinicId: string) {
  return {
    rfidTagEpc: equipment.rfidTagEpc,
    lastRfidSeenAt: equipment.lastRfidSeenAt,
    lastRfidRoomId: equipment.lastRfidRoomId,
    lastRfidGatewayCode: equipment.lastRfidGatewayCode,
    lastRfidRoomName: sql<string | null>`(
      SELECT r.name FROM vt_rooms r
      WHERE r.id = ${equipment.lastRfidRoomId} AND r.clinic_id = ${clinicId}
      LIMIT 1
    )`.as("lastRfidRoomName"),
    // R-M1.4 — origin room of the most recent directional read (read-only
    // display signal; never mutates the authoritative roomId). NULL for a
    // non-directional / legacy read; tenant-scoped by clinic on every join.
    lastRfidFromRoomName: sql<string | null>`(
      SELECT fr.name
      FROM vt_equipment_rfid_reads rd
      JOIN vt_rooms fr ON fr.id = rd.from_room_id AND fr.clinic_id = ${clinicId}
      WHERE rd.equipment_id = ${equipment.id}
        AND rd.clinic_id = ${clinicId}
        AND rd.from_room_id IS NOT NULL
      ORDER BY rd.read_at DESC
      LIMIT 1
    )`.as("lastRfidFromRoomName"),
    lastRfidRoomIsDock: sql<boolean>`EXISTS (
      SELECT 1 FROM vt_docks d
      WHERE d.room_id = ${equipment.lastRfidRoomId} AND d.clinic_id = ${clinicId}
    )`.as("lastRfidRoomIsDock"),
  };
}
