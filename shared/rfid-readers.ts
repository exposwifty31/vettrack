/**
 * Derived RFID reader registry (Phase 7c). There is no reader ENTITY in the
 * schema — a "reader" is a gateway, inferred from two live signals:
 *   1. rooms.gatewayCode          — the gateway assigned to a room (its location)
 *   2. equipment.lastRfidGatewayCode + lastRfidSeenAt — the doorway heartbeat
 * This module holds the wire type + the pure merge/heartbeat logic so it is unit
 * testable without a DB. Read-only: the registry is observed, never authoritative.
 */

/** Recency window: a reader seen within this is "online"; older ⇒ "stale". */
export const READER_ONLINE_WINDOW_MS = 5 * 60 * 1000;

export type RfidReaderStatus = "online" | "stale" | "no_signal";

export type RfidReaderRow = {
  gatewayCode: string;
  /** Room this gateway is assigned to (rooms.gatewayCode), or null if only observed. */
  roomId: string | null;
  roomName: string | null;
  /** Most recent doorway observation across equipment reporting this gateway (ISO), or null. */
  lastSeenAt: string | null;
  /** Distinct equipment that have this gateway as their last observed reader. */
  observedEquipmentCount: number;
  status: RfidReaderStatus;
};

/** A room with an assigned gateway (source 1). */
export type ReaderRoomAssignment = { gatewayCode: string; roomId: string; roomName: string };
/** Aggregated doorway heartbeat per gateway (source 2). */
export type ReaderObservation = { gatewayCode: string; lastSeenAt: string | null; observedEquipmentCount: number };

export function readerStatus(lastSeenAt: string | null, nowMs: number): RfidReaderStatus {
  if (!lastSeenAt) return "no_signal";
  const seenMs = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seenMs)) return "no_signal";
  return nowMs - seenMs <= READER_ONLINE_WINDOW_MS ? "online" : "stale";
}

/**
 * Full-outer merge of the two sources by gatewayCode (a gateway can be assigned
 * to a room but never observed, or observed but not yet assigned). Sorted by
 * gatewayCode for stable rendering. Pure — no DB, no clock beyond the passed `nowMs`.
 */
export function mergeReaderRows(
  rooms: ReaderRoomAssignment[],
  observations: ReaderObservation[],
  nowMs: number,
): RfidReaderRow[] {
  const byGateway = new Map<string, RfidReaderRow>();

  for (const r of rooms) {
    byGateway.set(r.gatewayCode, {
      gatewayCode: r.gatewayCode,
      roomId: r.roomId,
      roomName: r.roomName,
      lastSeenAt: null,
      observedEquipmentCount: 0,
      status: "no_signal",
    });
  }

  for (const o of observations) {
    const existing = byGateway.get(o.gatewayCode);
    if (existing) {
      existing.lastSeenAt = o.lastSeenAt;
      existing.observedEquipmentCount = o.observedEquipmentCount;
      existing.status = readerStatus(o.lastSeenAt, nowMs);
    } else {
      byGateway.set(o.gatewayCode, {
        gatewayCode: o.gatewayCode,
        roomId: null,
        roomName: null,
        lastSeenAt: o.lastSeenAt,
        observedEquipmentCount: o.observedEquipmentCount,
        status: readerStatus(o.lastSeenAt, nowMs),
      });
    }
  }

  return [...byGateway.values()].sort((a, b) => a.gatewayCode.localeCompare(b.gatewayCode));
}
