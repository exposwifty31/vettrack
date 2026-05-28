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
    lastRfidRoomIsDock: sql<boolean>`EXISTS (
      SELECT 1 FROM vt_docks d
      WHERE d.room_id = ${equipment.lastRfidRoomId} AND d.clinic_id = ${clinicId}
    )`.as("lastRfidRoomIsDock"),
  };
}
