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
    // R-M1.4 — origin room of the SAME latest read that set lastRfidRoomId
    // (its to_room_id; egress never inserts a reads row, so the newest reads
    // row's destination always equals lastRfidRoomId). Both endpoints therefore
    // describe ONE crossing — no cross-read mispairing. A LEFT JOIN yields a
    // NULL name when that latest crossing had a NULL origin (M1.2c "entered from
    // external" / first-ever read), so getRfidDirection renders "entered {to}"
    // rather than fabricating a from→to movement that never happened. Read-only
    // display signal; never mutates the authoritative roomId. The correlation is
    // qualified (`"vt_equipment"."id"`) so it resolves against the outer row and
    // never shadows to rd.id in a single-table (join-less) select; tenant-scoped
    // by clinic on both the read and the room lookup.
    lastRfidFromRoomName: sql<string | null>`(
      SELECT fr.name
      FROM vt_equipment_rfid_reads rd
      LEFT JOIN vt_rooms fr ON fr.id = rd.from_room_id AND fr.clinic_id = ${clinicId}
      WHERE rd.equipment_id = "vt_equipment"."id"
        AND rd.clinic_id = ${clinicId}
      ORDER BY rd.read_at DESC
      LIMIT 1
    )`.as("lastRfidFromRoomName"),
    lastRfidRoomIsDock: sql<boolean>`EXISTS (
      SELECT 1 FROM vt_docks d
      WHERE d.room_id = ${equipment.lastRfidRoomId} AND d.clinic_id = ${clinicId}
    )`.as("lastRfidRoomIsDock"),
  };
}
