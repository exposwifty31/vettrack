import { randomUUID } from "crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, rooms, equipment, rfidReaders } from "../db.js";
import type { RfidReader } from "../schema/equipment.js";
import {
  managedReaderHealth,
  mergeReaderRows,
  type ManagedRfidReaderRow,
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

// ─── Managed reader entity CRUD (R-M1.1b) ─────────────────────────────────────
// The `vt_rfid_readers` table is the first-class managed entity. Every mutation is
// clinicId-scoped in the WHERE clause: a cross-clinic id matches 0 rows → returns null
// (the route surfaces 404). Tenant safety is ALSO enforced in the DB (composite unique +
// composite FKs, migration 172). CRUD writes ONLY vt_rfid_readers — never custody (R-M1
// guardrail 1). Health is derived from the reader's OWN heartbeat, never asset traffic.

export type CreateRfidReaderInput = {
  name: string;
  gatewayCode: string;
  roomId?: string | null;
  physicalLocation?: string | null;
};

function toManagedRow(r: RfidReader, nowMs: number): ManagedRfidReaderRow {
  const lastSeenAt = r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : null;
  const lastReaderHeartbeatAt = r.lastReaderHeartbeatAt
    ? new Date(r.lastReaderHeartbeatAt).toISOString()
    : null;
  return {
    id: r.id,
    clinicId: r.clinicId,
    name: r.name,
    gatewayCode: r.gatewayCode,
    roomId: r.roomId ?? null,
    fromRoomId: r.fromRoomId ?? null,
    toRoomId: r.toRoomId ?? null,
    gateType: r.gateType ?? null,
    physicalLocation: r.physicalLocation ?? null,
    status: r.status,
    provisioningState: r.provisioningState,
    lastSeenAt,
    lastReaderHeartbeatAt,
    health: managedReaderHealth(lastReaderHeartbeatAt, nowMs),
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}

/**
 * Create a managed reader. `gateType`/adjacency are left UNSET (net-new, unconfigured) so
 * the reader is exempt from the directional-pair rules until an admin configures it
 * (R-M1.2). The DB composite unique `(clinicId, gatewayCode)` rejects a duplicate gateway.
 */
export async function createRfidReader(
  clinicId: string,
  input: CreateRfidReaderInput,
): Promise<ManagedRfidReaderRow> {
  const [row] = await db
    .insert(rfidReaders)
    .values({
      id: randomUUID(),
      clinicId,
      name: input.name,
      gatewayCode: input.gatewayCode,
      roomId: input.roomId ?? null,
      physicalLocation: input.physicalLocation ?? null,
      provisioningState: "unconfigured",
      status: "active",
    })
    .returning();
  return toManagedRow(row, Date.now());
}

/** Rename a reader. Clinic-scoped; a cross-clinic id matches nothing → null. */
export async function renameRfidReader(
  clinicId: string,
  id: string,
  name: string,
): Promise<ManagedRfidReaderRow | null> {
  const [row] = await db
    .update(rfidReaders)
    .set({ name })
    .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.id, id)))
    .returning();
  return row ? toManagedRow(row, Date.now()) : null;
}

/** Deactivate a reader (status → inactive). Clinic-scoped; cross-clinic id → null. */
export async function deactivateRfidReader(
  clinicId: string,
  id: string,
): Promise<ManagedRfidReaderRow | null> {
  const [row] = await db
    .update(rfidReaders)
    .set({ status: "inactive" })
    .where(and(eq(rfidReaders.clinicId, clinicId), eq(rfidReaders.id, id)))
    .returning();
  return row ? toManagedRow(row, Date.now()) : null;
}

/**
 * List managed readers for a clinic, health derived from each reader's OWN heartbeat
 * (`lastReaderHeartbeatAt`), NEVER from equipment asset-read traffic. Clinic-scoped.
 */
export async function listManagedRfidReaders(
  clinicId: string,
  nowMs: number = Date.now(),
): Promise<ManagedRfidReaderRow[]> {
  const rows = await db
    .select()
    .from(rfidReaders)
    .where(eq(rfidReaders.clinicId, clinicId));
  return rows
    .map((r) => toManagedRow(r, nowMs))
    .sort((a, b) => a.gatewayCode.localeCompare(b.gatewayCode));
}
