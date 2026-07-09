import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, rooms, equipment } from "../db.js";
import {
  mergeReaderRows,
  type RfidReaderRow,
  type ReaderRoomAssignment,
  type ReaderObservation,
} from "../../shared/rfid-readers.js";

/**
 * Derives the RFID reader registry for a clinic from live signals (rooms.gatewayCode
 * + equipment doorway observations). Read-only; clinic scope enforced on both queries.
 */
export async function listRfidReaders(clinicId: string): Promise<RfidReaderRow[]> {
  const roomRows = await db
    .select({ gatewayCode: rooms.gatewayCode, roomId: rooms.id, roomName: rooms.name })
    .from(rooms)
    .where(and(eq(rooms.clinicId, clinicId), isNotNull(rooms.gatewayCode)));

  const obsRows = await db
    .select({
      gatewayCode: equipment.lastRfidGatewayCode,
      lastSeenAt: sql<string | null>`max(${equipment.lastRfidSeenAt})`,
      observedEquipmentCount: sql<number>`count(*)::int`,
    })
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), isNotNull(equipment.lastRfidGatewayCode)))
    .groupBy(equipment.lastRfidGatewayCode);

  const assignments: ReaderRoomAssignment[] = roomRows
    .filter((r): r is { gatewayCode: string; roomId: string; roomName: string } => r.gatewayCode != null)
    .map((r) => ({ gatewayCode: r.gatewayCode, roomId: r.roomId, roomName: r.roomName }));

  const observations: ReaderObservation[] = obsRows
    .filter((o): o is { gatewayCode: string; lastSeenAt: string | null; observedEquipmentCount: number } =>
      o.gatewayCode != null,
    )
    .map((o) => ({
      gatewayCode: o.gatewayCode,
      // pg returns max(timestamptz) as a Date; normalize to ISO so the wire format
      // is stable regardless of the driver's type parser (the type claims string).
      lastSeenAt: o.lastSeenAt ? new Date(o.lastSeenAt).toISOString() : null,
      observedEquipmentCount: Number(o.observedEquipmentCount ?? 0),
    }));

  return mergeReaderRows(assignments, observations, Date.now());
}
