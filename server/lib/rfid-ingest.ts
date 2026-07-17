import { createHash, randomUUID } from "crypto";
import { and, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import {
  db,
  docks,
  equipment,
  equipmentRfidReads,
  rfidEgressSignals,
  rfidReaders,
  rooms,
} from "../db.js";
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

export type RfidDirection = "entered" | "exited";

export interface RfidBatchEvent {
  tagEpc: string;
  gatewayCode: string;
  readAt: string;
  /** R-M1.2a — optional directional intent, interpreted relative to the reader's from/to rooms. */
  direction?: RfidDirection;
  /** R-M1.2a — optional COMPLETE gateway pair (both or neither); corroborates direction. */
  fromGateway?: string;
  toGateway?: string;
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
  /** R-M1.2 — directional reads whose destination room was resolved from direction. */
  directionalResolved: number;
  /** R-M1.2c — new possible_egress signals persisted (post-dedup) this batch. */
  possibleEgress: number;
}

/**
 * R-M1.2a — a directional payload that cannot be resolved DETERMINISTICALLY is a hard reject
 * (4xx), never a silent downgrade to last-seen. Thrown from the ingest and mapped to an HTTP
 * status by the route. Legacy (no-direction) payloads never trigger this.
 */
export type RfidDirectionalRejectionCode =
  | "PARTIAL_GATEWAY_PAIR"
  | "UNKNOWN_GATEWAY"
  | "GATEWAY_NOT_DIRECTIONAL"
  | "DIRECTION_GATEWAY_DISAGREEMENT"
  | "DIRECTION_UNRESOLVABLE";

export class RfidDirectionalRejection extends Error {
  readonly code: RfidDirectionalRejectionCode;
  constructor(code: RfidDirectionalRejectionCode, message: string) {
    super(message);
    this.name = "RfidDirectionalRejection";
    this.code = code;
  }
}

/** Bounded window: an exit is a "possible egress" only when no matching entry precedes it here. */
const EGRESS_MATCHING_ENTRY_WINDOW_MS = 24 * 60 * 60 * 1000;

function isDirectionalEvent(ev: RfidBatchEvent): boolean {
  return ev.direction != null || ev.fromGateway != null || ev.toGateway != null;
}

type ReaderConfig = {
  id: string;
  gatewayCode: string;
  roomId: string | null;
  fromRoomId: string | null;
  toRoomId: string | null;
  gateType: string | null;
};

type DirectionalResolution = {
  gateId: string;
  direction: RfidDirection;
  /** the room the asset moved FROM (null => external zone). */
  srcRoomId: string | null;
  /** the room the asset moved TO (null => external zone => possible egress). */
  destRoomId: string | null;
  /** the gate's home/mounting (internal) room — used to match a prior entry for egress. */
  internalRoomId: string;
  gateType: string;
};

/**
 * R-M1.2a — resolve a directional event to a src/dest room DETERMINISTICALLY, or throw a hard
 * rejection. PINNED precedence: direction is interpreted relative to the reader's configured
 * from/to rooms (home = mounting room, away = the other endpoint, which is NULL/external for a
 * boundary or dock gate); a supplied gateway pair must be complete, in-clinic, and agree with
 * `direction`. `entered` => destination = home; `exited` => destination = away.
 */
function resolveDirectionalEvent(
  ev: RfidBatchEvent,
  readerByGateway: Map<string, ReaderConfig>,
): DirectionalResolution {
  const hasFrom = ev.fromGateway != null;
  const hasTo = ev.toGateway != null;
  if (hasFrom !== hasTo) {
    throw new RfidDirectionalRejection(
      "PARTIAL_GATEWAY_PAIR",
      "A gateway pair must supply BOTH fromGateway and toGateway",
    );
  }

  const reader = readerByGateway.get(ev.gatewayCode);
  if (!reader) {
    throw new RfidDirectionalRejection(
      "UNKNOWN_GATEWAY",
      `Gateway ${ev.gatewayCode} is not a managed reader in this clinic`,
    );
  }
  if (reader.gateType == null || reader.roomId == null) {
    throw new RfidDirectionalRejection(
      "GATEWAY_NOT_DIRECTIONAL",
      `Reader ${ev.gatewayCode} is not configured for directional resolution`,
    );
  }

  const home = reader.roomId;
  const away = reader.fromRoomId === home ? reader.toRoomId : reader.fromRoomId;

  let pairDirection: RfidDirection | null = null;
  if (hasFrom && hasTo) {
    const fromGateway = ev.fromGateway as string;
    const toGateway = ev.toGateway as string;
    if (!readerByGateway.has(fromGateway) || !readerByGateway.has(toGateway)) {
      throw new RfidDirectionalRejection(
        "UNKNOWN_GATEWAY",
        "A gateway pair referenced a reader outside this clinic",
      );
    }
    if (toGateway === ev.gatewayCode) {
      pairDirection = "entered";
    } else if (fromGateway === ev.gatewayCode) {
      pairDirection = "exited";
    } else {
      throw new RfidDirectionalRejection(
        "DIRECTION_GATEWAY_DISAGREEMENT",
        "The event gateway is not part of the supplied gateway pair",
      );
    }
  }

  if (ev.direction != null && pairDirection != null && ev.direction !== pairDirection) {
    throw new RfidDirectionalRejection(
      "DIRECTION_GATEWAY_DISAGREEMENT",
      `direction '${ev.direction}' contradicts the supplied gateway pair`,
    );
  }

  const direction = ev.direction ?? pairDirection;
  if (direction == null) {
    throw new RfidDirectionalRejection(
      "DIRECTION_UNRESOLVABLE",
      "A directional payload must supply a direction or a complete gateway pair",
    );
  }

  return {
    gateId: reader.id,
    direction,
    srcRoomId: direction === "entered" ? away : home,
    destRoomId: direction === "entered" ? home : away,
    internalRoomId: home,
    gateType: reader.gateType,
  };
}

/**
 * Deterministic fingerprint of the intrinsic read (equipment + gateway + readAt + direction) —
 * NOT the batch id — so a retry or an out-of-order batch that re-reports the SAME physical exit
 * collapses to the SAME correlation key and dedupes, while two distinct exits stay separate.
 */
function egressSourceEventId(equipmentId: string, gatewayCode: string, readAtIso: string): string {
  return createHash("sha256")
    .update(`${equipmentId}|${gatewayCode}|${readAtIso}|exited`)
    .digest("hex");
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
    directionalResolved: 0,
    possibleEgress: 0,
  };

  const serverNow = new Date();
  // R-M1.2 — directional events are NOT coalesced-per-tag (each is a distinct movement/crossing
  // and multiple legitimate crossings of one tag in a batch must all be processed). The legacy
  // (no-direction) path keeps its byte-for-byte coalesce-latest-per-tag behavior.
  const legacyEvents = batch.events.filter((e) => !isDirectionalEvent(e));
  const directionalEvents = batch.events
    .filter((e) => isDirectionalEvent(e))
    .sort((a, b) => new Date(a.readAt).getTime() - new Date(b.readAt).getTime());
  const coalesced = coalesceLatestPerTag(legacyEvents);
  if (coalesced.length === 0 && directionalEvents.length === 0) return result;

  const tagEpcs = [...new Set(batch.events.map((e) => e.tagEpc))];
  const gatewayCodes = [...new Set(batch.events.map((e) => e.gatewayCode))];
  const directionalGatewayCodes = [
    ...new Set(
      directionalEvents.flatMap((e) =>
        [e.gatewayCode, e.fromGateway, e.toGateway].filter((c): c is string => Boolean(c)),
      ),
    ),
  ];
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

    // R-M1.2 — directional resolution keys off the MANAGED reader registry (vt_rfid_readers),
    // never the legacy rooms.gateway_code mapping. Fetched only when the batch carries
    // directional events, so the legacy path issues zero extra queries.
    const readerByGateway = new Map<string, ReaderConfig>();
    if (directionalGatewayCodes.length > 0) {
      const readerRows = await tx
        .select({
          id: rfidReaders.id,
          gatewayCode: rfidReaders.gatewayCode,
          roomId: rfidReaders.roomId,
          fromRoomId: rfidReaders.fromRoomId,
          toRoomId: rfidReaders.toRoomId,
          gateType: rfidReaders.gateType,
        })
        .from(rfidReaders)
        .where(
          and(
            eq(rfidReaders.clinicId, clinicId),
            inArray(rfidReaders.gatewayCode, directionalGatewayCodes),
          ),
        );
      for (const r of readerRows) readerByGateway.set(r.gatewayCode, r);
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

    // R-M1.2 — directional processing. PINNED: validate EVERY directional event first (a
    // partial pair / direction-gateway disagreement / unknown-or-cross-clinic gateway is a HARD
    // REJECT that rolls the whole batch back — never a silent downgrade to last-seen). Then apply.
    const resolvedDirectional = directionalEvents.map((ev) => ({
      ev,
      resolution: resolveDirectionalEvent(ev, readerByGateway),
    }));

    for (const { ev, resolution } of resolvedDirectional) {
      const eqRow = equipmentByEpc.get(ev.tagEpc);
      if (!eqRow) {
        result.unknownTag += 1;
        incrementMetric("rfid_event_unknown_tag");
        continue;
      }

      const readAt = new Date(ev.readAt);
      if (Number.isNaN(readAt.getTime())) {
        result.stale += 1;
        incrementMetric("rfid_event_stale");
        continue;
      }

      // External exit (boundary/dock gate toward the NULL endpoint) => possible egress. It is
      // ADVISORY: it never advances last-seen (the asset keeps its last known room) and NEVER
      // mutates custody. Idempotent per the correlation key (retries/out-of-order dedupe).
      if (resolution.destRoomId == null) {
        const windowStart = new Date(readAt.getTime() - EGRESS_MATCHING_ENTRY_WINDOW_MS);
        const priorEntry = await tx
          .select({ id: equipmentRfidReads.id })
          .from(equipmentRfidReads)
          .where(
            and(
              eq(equipmentRfidReads.clinicId, clinicId),
              eq(equipmentRfidReads.equipmentId, eqRow.id),
              eq(equipmentRfidReads.gatewayCode, ev.gatewayCode),
              eq(equipmentRfidReads.toRoomId, resolution.internalRoomId),
              lt(equipmentRfidReads.readAt, readAt),
              gte(equipmentRfidReads.readAt, windowStart),
            ),
          )
          .limit(1);
        if (priorEntry.length > 0) {
          // A matching prior entry through this gate => expected round-trip, not an egress.
          continue;
        }

        const sourceEventId = egressSourceEventId(eqRow.id, ev.gatewayCode, readAt.toISOString());
        const inserted = await tx
          .insert(rfidEgressSignals)
          .values({
            id: randomUUID(),
            clinicId,
            equipmentId: eqRow.id,
            gateId: resolution.gateId,
            gatewayCode: ev.gatewayCode,
            sourceEventId,
            fromRoomId: resolution.internalRoomId,
            batchId: batch.batchId,
            detectedAt: readAt,
          })
          .onConflictDoNothing({
            target: [
              rfidEgressSignals.clinicId,
              rfidEgressSignals.equipmentId,
              rfidEgressSignals.gateId,
              rfidEgressSignals.sourceEventId,
            ],
          })
          .returning({ id: rfidEgressSignals.id });
        if (inserted.length > 0) {
          result.possibleEgress += 1;
          incrementMetric("rfid_possible_egress");
        } else {
          incrementMetric("rfid_possible_egress_deduped");
        }
        continue;
      }

      const destRoomId = resolution.destRoomId;

      if (eqRow.lastRfidSeenAt && readAt.getTime() <= eqRow.lastRfidSeenAt.getTime()) {
        result.stale += 1;
        incrementMetric("rfid_event_stale");
        continue;
      }

      if (eqRow.lastRfidRoomId === destRoomId) {
        const advanced = await tx
          .update(equipment)
          .set({ lastRfidSeenAt: readAt, lastRfidGatewayCode: ev.gatewayCode })
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

      const advanced = await tx
        .update(equipment)
        .set({
          lastRfidRoomId: destRoomId,
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
        fromRoomId: resolution.srcRoomId,
        toRoomId: destRoomId,
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
          fromRoomId: resolution.srcRoomId,
          toRoomId: destRoomId,
          direction: resolution.direction,
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
          fromRoomId: resolution.srcRoomId,
          toRoomId: destRoomId,
          direction: resolution.direction,
          gatewayCode: ev.gatewayCode,
          at: readAt.toISOString(),
        },
        occurredAt: readAt,
      });

      eqRow.lastRfidRoomId = destRoomId;
      eqRow.lastRfidSeenAt = readAt;
      result.updated += 1;
      result.directionalResolved += 1;
      incrementMetric("rfid_event_room_changed");
      incrementMetric("rfid_event_directional_resolved");

      rfidElsewhereCandidates.push({
        equipmentId: eqRow.id,
        dockId: eqRow.dockId,
        newRoomId: destRoomId,
      });

      const dirHomeRoomIds = buildEquipmentHomeRoomIds(
        eqRow.roomId,
        eqRow.dockId ? dockRoomByDockId.get(eqRow.dockId) ?? null : null,
      );
      if (
        eqRow.custodyState === "checked_out" &&
        eqRow.checkedOutById &&
        eqRow.checkedOutAt &&
        dirHomeRoomIds.size > 0 &&
        isEquipmentHomeRoom(destRoomId, dirHomeRoomIds)
      ) {
        semiDockCandidates.push({
          clinicId,
          equipmentId: eqRow.id,
          equipmentName: eqRow.name,
          checkedOutById: eqRow.checkedOutById,
          checkedOutAt: eqRow.checkedOutAt,
          homeRoomId: destRoomId,
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
