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

/**
 * Managed reader (R-M1.1b): the first-class `vt_rfid_readers` entity, distinct from the
 * derived registry above. `status` is the lifecycle column (active | inactive); `health`
 * is derived from the reader's OWN heartbeat (lastReaderHeartbeatAt), NEVER from equipment
 * asset-read traffic — a healthy-but-quiet reader with no equipment passing it must not
 * read as offline (R-M1.1d semantics).
 */
export type ManagedReaderHealth = "online" | "offline" | "no_signal";

/** Reader-heartbeat staleness window: a heartbeat within this ⇒ "online"; older ⇒ "offline". */
export const READER_HEARTBEAT_ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Health from the reader's own heartbeat only. `lastSeenAt` (asset-read traffic) is
 * deliberately NOT an input — passing asset traffic here would resurrect the bug the
 * card forbids (a quiet-but-healthy reader reading offline, or an asset-only reader
 * reading online).
 */
export function managedReaderHealth(lastReaderHeartbeatAt: string | null, nowMs: number): ManagedReaderHealth {
  return managedReaderHealthWithThreshold(lastReaderHeartbeatAt, nowMs, READER_HEARTBEAT_ONLINE_WINDOW_MS);
}

/**
 * Same health computation as {@link managedReaderHealth} but with an explicit staleness
 * threshold — the R-M1.1d reader-offline sweep resolves a per-clinic threshold and passes it
 * here, so the window is a single source of truth and the per-clinic seam never forks the logic.
 */
export function managedReaderHealthWithThreshold(
  lastReaderHeartbeatAt: string | null,
  nowMs: number,
  thresholdMs: number,
): ManagedReaderHealth {
  if (!lastReaderHeartbeatAt) return "no_signal";
  const beatMs = new Date(lastReaderHeartbeatAt).getTime();
  if (Number.isNaN(beatMs)) return "no_signal";
  return nowMs - beatMs <= thresholdMs ? "online" : "offline";
}

/**
 * R-M1.1d persisted health vocabulary (vt_rfid_readers.reader_health_status). Distinct from the
 * derived {@link ManagedReaderHealth} display value: 'unknown' is the never-observed-healthy
 * state (no signal, never a degradation) so it emits no offline transition.
 */
export type PersistedReaderHealth = "healthy" | "offline" | "unknown";

/** Maps the derived health to the persisted-state vocabulary used for transition dedup. */
export function toPersistedReaderHealth(health: ManagedReaderHealth): PersistedReaderHealth {
  if (health === "online") return "healthy";
  if (health === "offline") return "offline";
  return "unknown";
}

export type ManagedRfidReaderRow = {
  id: string;
  clinicId: string;
  name: string;
  gatewayCode: string;
  roomId: string | null;
  fromRoomId: string | null;
  toRoomId: string | null;
  gateType: string | null;
  physicalLocation: string | null;
  /** Lifecycle: active | inactive. */
  status: string;
  provisioningState: string;
  /** Informational: last accepted asset (equipment) read; display only, never drives health. */
  lastSeenAt: string | null;
  /** Dedicated reader-health timestamp (R-M1.1d); the sole input to `health`. */
  lastReaderHeartbeatAt: string | null;
  /** Derived from `lastReaderHeartbeatAt` only. */
  health: ManagedReaderHealth;
  createdAt: string | null;
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
