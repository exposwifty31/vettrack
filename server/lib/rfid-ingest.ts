import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, docks, equipment, equipmentRfidReads, rfidReaders, rooms } from "../db.js";
import { logAudit } from "./audit.js";
import { incrementMetric } from "./metrics.js";
import { insertRealtimeDomainEvent } from "./realtime-outbox.js";
import {
  buildEquipmentHomeRoomIds,
  deliverSemiDockPush,
  isEquipmentHomeRoom,
  type SemiDockNotifyCandidate,
} from "./semi-dock-notify.js";
import { getCurrentAnchor, invalidateCurrentAnchor } from "../services/equipment-anchor.service.js";

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

type RfidElsewhereCandidate = {
  equipmentId: string;
  dockId: string | null;
  newRoomId: string;
};

/**
 * D-13 anchor contradiction: an RFID read placed the item in a room
 * different from its current anchor's station room. No current anchor, or
 * the new room matches the anchor's station room, is a no-op. Off the
 * ingest hot path — always called fire-and-forget (see ingestRfidBatch).
 */
async function invalidateAnchorIfRfidElsewhere(
  clinicId: string,
  candidate: RfidElsewhereCandidate,
): Promise<void> {
  try {
    const anchor = await getCurrentAnchor(clinicId, candidate.equipmentId);
    if (!anchor) return;

    let stationRoomId: string | null = null;
    if (anchor.dockId) {
      const [dockRow] = await db
        .select({ roomId: docks.roomId })
        .from(docks)
        .where(and(eq(docks.clinicId, clinicId), eq(docks.id, anchor.dockId)))
        .limit(1);
      stationRoomId = dockRow?.roomId ?? null;
    }
    if (!stationRoomId) {
      stationRoomId = anchor.roomId ?? null;
    }

    if (!stationRoomId || stationRoomId === candidate.newRoomId) return;

    await invalidateCurrentAnchor(db, {
      clinicId,
      equipmentId: candidate.equipmentId,
      reason: "rfid_elsewhere",
    });
  } catch (err) {
    console.error("[docking] anchor invalidation failed (rfid_elsewhere, non-fatal):", err);
  }
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

  const serverNow = new Date();
  const coalesced = coalesceLatestPerTag(batch.events);
  if (coalesced.length === 0) return result;

  const tagEpcs = [...new Set(coalesced.map((e) => e.tagEpc))];
  const gatewayCodes = [...new Set(coalesced.map((e) => e.gatewayCode))];
  const semiDockCandidates: SemiDockNotifyCandidate[] = [];
  const rfidElsewhereCandidates: RfidElsewhereCandidate[] = [];

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

    // R-M1.1d — reader-level liveness: an accepted ingest batch IS a heartbeat for every managed
    // reader whose gateway appears in it (independent of per-event tag matches — the reader is
    // transmitting). Server-set timestamp, NEVER the client-supplied readAt. Feeds the
    // reader-offline sweep's staleness check (server/lib/rfid/reader-offline-sweep.ts). Matches 0
    // rows for a legacy clinic with no managed readers, so legacy ingest stays byte-for-byte
    // unchanged. Never touches custody (R-M1 guardrail 1).
    await tx
      .update(rfidReaders)
      .set({ lastReaderHeartbeatAt: serverNow })
      .where(and(eq(rfidReaders.clinicId, clinicId), inArray(rfidReaders.gatewayCode, gatewayCodes)));

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

      rfidElsewhereCandidates.push({ equipmentId: eqRow.id, dockId: eqRow.dockId, newRoomId: roomId });

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

  // D-13 anchor contradiction: off the ingest hot path — fire-and-forget,
  // dispatched only after the transaction above has committed.
  for (const candidate of rfidElsewhereCandidates) {
    void invalidateAnchorIfRfidElsewhere(clinicId, candidate);
  }

  return result;
}
