import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, docks, equipment, equipmentRfidReads, rooms } from "../db.js";
import { logAudit } from "./audit.js";
import { incrementMetric } from "./metrics.js";
import { insertRealtimeDomainEvent } from "./realtime-outbox.js";
import {
  buildEquipmentHomeRoomIds,
  deliverSemiDockPush,
  isEquipmentHomeRoom,
  type SemiDockNotifyCandidate,
} from "./semi-dock-notify.js";

export interface RfidBatchEvent {
  tagEpc: string;
  gatewayCode: string;
  readAt: string;
}

export interface RfidBatchInput {
  batchId: string;
  controllerVersion?: string;
  events: RfidBatchEvent[];
}

export interface RfidIngestResult {
  accepted: number;
  updated: number;
  unchanged: number;
  unknownTag: number;
  unknownGateway: number;
  stale: number;
}

type EquipmentRfidRow = {
  id: string;
  name: string;
  roomId: string | null;
  dockId: string | null;
  custodyState: string;
  checkedOutById: string | null;
  checkedOutAt: Date | null;
  lastRfidRoomId: string | null;
  lastRfidSeenAt: Date | null;
  rfidTagEpc: string | null;
};

/** Only advance advisory RFID columns when the event read is strictly newer than stored. */
function rfidSeenAtCanAdvance(readAt: Date) {
  return or(isNull(equipment.lastRfidSeenAt), lt(equipment.lastRfidSeenAt, readAt));
}

function equipmentRfidUpdateScope(equipmentId: string, clinicId: string, readAt: Date) {
  return and(
    eq(equipment.id, equipmentId),
    eq(equipment.clinicId, clinicId),
    rfidSeenAtCanAdvance(readAt),
  );
}

function coalesceLatestPerTag(events: RfidBatchEvent[]): RfidBatchEvent[] {
  const byTag = new Map<string, RfidBatchEvent>();
  const sorted = [...events].sort(
    (a, b) => new Date(a.readAt).getTime() - new Date(b.readAt).getTime(),
  );
  for (const ev of sorted) {
    byTag.set(ev.tagEpc, ev);
  }
  return [...byTag.values()];
}

export async function ingestRfidBatch(
  clinicId: string,
  batch: RfidBatchInput,
): Promise<RfidIngestResult> {
  const result: RfidIngestResult = {
    accepted: batch.events.length,
    updated: 0,
    unchanged: 0,
    unknownTag: 0,
    unknownGateway: 0,
    stale: 0,
  };

  const coalesced = coalesceLatestPerTag(batch.events);
  if (coalesced.length === 0) return result;

  const tagEpcs = [...new Set(coalesced.map((e) => e.tagEpc))];
  const gatewayCodes = [...new Set(coalesced.map((e) => e.gatewayCode))];
  const semiDockCandidates: SemiDockNotifyCandidate[] = [];

  await db.transaction(async (tx) => {
    const equipmentRows = await tx
      .select({
        id: equipment.id,
        name: equipment.name,
        roomId: equipment.roomId,
        dockId: equipment.dockId,
        custodyState: equipment.custodyState,
        checkedOutById: equipment.checkedOutById,
        checkedOutAt: equipment.checkedOutAt,
        lastRfidRoomId: equipment.lastRfidRoomId,
        lastRfidSeenAt: equipment.lastRfidSeenAt,
        rfidTagEpc: equipment.rfidTagEpc,
      })
      .from(equipment)
      .where(and(eq(equipment.clinicId, clinicId), inArray(equipment.rfidTagEpc, tagEpcs)));

    const equipmentDockIds = [
      ...new Set(equipmentRows.map((r) => r.dockId).filter((id): id is string => Boolean(id))),
    ];
    const dockRoomByDockId = new Map<string, string>();
    if (equipmentDockIds.length > 0) {
      const dockRows = await tx
        .select({ id: docks.id, roomId: docks.roomId })
        .from(docks)
        .where(and(eq(docks.clinicId, clinicId), inArray(docks.id, equipmentDockIds)));
      for (const d of dockRows) {
        if (d.roomId) dockRoomByDockId.set(d.id, d.roomId);
      }
    }

    const roomRows = await tx
      .select({ id: rooms.id, gatewayCode: rooms.gatewayCode })
      .from(rooms)
      .where(and(eq(rooms.clinicId, clinicId), inArray(rooms.gatewayCode, gatewayCodes)));

    const equipmentByEpc = new Map<string, EquipmentRfidRow>();
    for (const row of equipmentRows) {
      if (row.rfidTagEpc) equipmentByEpc.set(row.rfidTagEpc, row);
    }
    const roomByGateway = new Map<string, string>();
    for (const row of roomRows) {
      if (row.gatewayCode) roomByGateway.set(row.gatewayCode, row.id);
    }

    for (const ev of coalesced) {
      const eqRow = equipmentByEpc.get(ev.tagEpc);
      if (!eqRow) {
        result.unknownTag += 1;
        incrementMetric("rfid_event_unknown_tag");
        continue;
      }

      const roomId = roomByGateway.get(ev.gatewayCode);
      if (!roomId) {
        result.unknownGateway += 1;
        incrementMetric("rfid_event_unknown_gateway");
        continue;
      }

      const readAt = new Date(ev.readAt);
      if (Number.isNaN(readAt.getTime())) {
        result.stale += 1;
        incrementMetric("rfid_event_stale");
        continue;
      }

      if (eqRow.lastRfidSeenAt && readAt.getTime() <= eqRow.lastRfidSeenAt.getTime()) {
        result.stale += 1;
        incrementMetric("rfid_event_stale");
        continue;
      }

      const roomUnchanged = eqRow.lastRfidRoomId === roomId;

      if (roomUnchanged) {
        const advanced = await tx
          .update(equipment)
          .set({
            lastRfidSeenAt: readAt,
            lastRfidGatewayCode: ev.gatewayCode,
          })
          .where(equipmentRfidUpdateScope(eqRow.id, clinicId, readAt))
          .returning({ id: equipment.id });

        if (advanced.length === 0) {
          result.stale += 1;
          incrementMetric("rfid_event_stale");
          continue;
        }

        eqRow.lastRfidSeenAt = readAt;
        result.unchanged += 1;
        incrementMetric("rfid_event_unchanged");
        continue;
      }

      const fromRoomId = eqRow.lastRfidRoomId;

      const advanced = await tx
        .update(equipment)
        .set({
          lastRfidRoomId: roomId,
          lastRfidSeenAt: readAt,
          lastRfidGatewayCode: ev.gatewayCode,
        })
        .where(equipmentRfidUpdateScope(eqRow.id, clinicId, readAt))
        .returning({ id: equipment.id });

      if (advanced.length === 0) {
        result.stale += 1;
        incrementMetric("rfid_event_stale");
        continue;
      }

      await tx.insert(equipmentRfidReads).values({
        id: randomUUID(),
        clinicId,
        equipmentId: eqRow.id,
        fromRoomId,
        toRoomId: roomId,
        gatewayCode: ev.gatewayCode,
        readAt,
        batchId: batch.batchId,
      });

      await logAudit({
        tx,
        clinicId,
        actionType: "equipment_rfid_observed_room_changed",
        performedBy: "system:rfid",
        performedByEmail: "rfid@vettrack.system",
        targetId: eqRow.id,
        targetType: "equipment",
        metadata: {
          fromRoomId,
          toRoomId: roomId,
          gatewayCode: ev.gatewayCode,
          readAt: readAt.toISOString(),
          batchId: batch.batchId,
        },
      });

      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "EQUIPMENT_RFID_OBSERVED",
        category: "SYSTEM",
        level: "INFO",
        payload: {
          equipmentId: eqRow.id,
          fromRoomId,
          toRoomId: roomId,
          gatewayCode: ev.gatewayCode,
          at: readAt.toISOString(),
        },
        occurredAt: readAt,
      });

      eqRow.lastRfidRoomId = roomId;
      eqRow.lastRfidSeenAt = readAt;
      result.updated += 1;
      incrementMetric("rfid_event_room_changed");

      const homeRoomIds = buildEquipmentHomeRoomIds(
        eqRow.roomId,
        eqRow.dockId ? dockRoomByDockId.get(eqRow.dockId) ?? null : null,
      );
      if (
        eqRow.custodyState === "checked_out" &&
        eqRow.checkedOutById &&
        eqRow.checkedOutAt &&
        homeRoomIds.size > 0 &&
        isEquipmentHomeRoom(roomId, homeRoomIds)
      ) {
        semiDockCandidates.push({
          clinicId,
          equipmentId: eqRow.id,
          equipmentName: eqRow.name,
          checkedOutById: eqRow.checkedOutById,
          checkedOutAt: eqRow.checkedOutAt,
          homeRoomId: roomId,
        });
      }
    }
  });

  for (const candidate of semiDockCandidates) {
    void deliverSemiDockPush(candidate);
  }

  return result;
}

/** Test helper: whether a room has at least one dock row (equipment-storage). */
export async function isDockRoom(clinicId: string, roomId: string | null): Promise<boolean> {
  if (!roomId) return false;
  const [row] = await db
    .select({ id: docks.id })
    .from(docks)
    .where(and(eq(docks.clinicId, clinicId), eq(docks.roomId, roomId)))
    .limit(1);
  return !!row;
}
