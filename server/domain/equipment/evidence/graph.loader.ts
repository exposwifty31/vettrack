import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  assetTypeConditions,
  db,
  equipment,
  equipmentReturns,
  equipmentRfidReads,
  rooms,
  scanLogs,
  stagingQueue,
  transferLogs,
  unitConditionStates,
} from "../../../db.js";
import { buildWaitlistSnapshot } from "../../../services/equipment-waitlist.service.js";
import type {
  EvidenceGraph,
  EvidenceReturnRow,
  EvidenceScanRow,
  EvidenceTransferRow,
  ResolverContext,
  SupersessionEvent,
} from "./graph.types.js";

const RECENT_SCAN_LIMIT = 20;
const RECENT_TRANSFER_LIMIT = 20;
const RECENT_RFID_LIMIT = 10;
const RECENT_RETURN_LIMIT = 20;

function mapSupersessionFromReturns(rows: EvidenceReturnRow[]): SupersessionEvent[] {
  return rows.map((r) => ({
    type: "return" as const,
    id: r.id,
    observedAt: r.returnedAt,
  }));
}

function mapSupersessionFromTransfers(rows: EvidenceTransferRow[]): SupersessionEvent[] {
  return rows.map((t) => ({
    type: "transfer" as const,
    id: t.id,
    observedAt: t.timestamp,
  }));
}

function deriveCustodySupersessionEvents(
  eqRow: NonNullable<EvidenceGraph["equipment"]>,
): SupersessionEvent[] {
  const events: SupersessionEvent[] = [];
  if (eqRow.custodyState === "docked" && eqRow.custodyStateSince) {
    events.push({
      type: "custody_docked",
      id: `${eqRow.id}:docked`,
      observedAt: eqRow.custodyStateSince,
    });
  }
  if (eqRow.custodyState === "returned" && eqRow.custodyStateSince) {
    events.push({
      type: "custody_returned",
      id: `${eqRow.id}:returned`,
      observedAt: eqRow.custodyStateSince,
    });
  }
  if (eqRow.custodyState === "untracked" && eqRow.custodyStateSince) {
    events.push({
      type: "custody_untracked",
      id: `${eqRow.id}:untracked`,
      observedAt: eqRow.custodyStateSince,
    });
  }
  return events;
}

/** Merge and sort supersession events newest-first for scanning. */
function mergeSupersessionEvents(...groups: SupersessionEvent[][]): SupersessionEvent[] {
  return groups.flat().sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
}

export async function loadEvidenceGraph(
  ctx: Pick<ResolverContext, "clinicId" | "equipmentId"> & { viewerUserId?: string },
): Promise<EvidenceGraph> {
  const { clinicId, equipmentId, viewerUserId } = ctx;
  const loadedAt = new Date();

  const [eqRow] = await db
    .select({
      id: equipment.id,
      clinicId: equipment.clinicId,
      name: equipment.name,
      custodyState: equipment.custodyState,
      custodyStateSince: equipment.custodyStateSince,
      checkedOutById: equipment.checkedOutById,
      checkedOutByEmail: equipment.checkedOutByEmail,
      checkedOutAt: equipment.checkedOutAt,
      checkedOutLocation: equipment.checkedOutLocation,
      readinessState: equipment.readinessState,
      usageState: equipment.usageState,
      assetTypeId: equipment.assetTypeId,
      roomId: equipment.roomId,
      dockId: equipment.dockId,
      location: equipment.location,
      lastRfidSeenAt: equipment.lastRfidSeenAt,
      lastRfidRoomId: equipment.lastRfidRoomId,
      lastSeen: equipment.lastSeen,
      conditionStatus: equipment.conditionStatus,
    })
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)));

  const equipmentSnapshot = eqRow ?? null;

  let assetTypeConditionsRows: typeof assetTypeConditions.$inferSelect[] = [];
  let unitConditionStatesRows: typeof unitConditionStates.$inferSelect[] = [];
  if (equipmentSnapshot?.assetTypeId) {
    assetTypeConditionsRows = await db
      .select()
      .from(assetTypeConditions)
      .where(
        and(
          eq(assetTypeConditions.assetTypeId, equipmentSnapshot.assetTypeId),
          eq(assetTypeConditions.clinicId, clinicId),
        ),
      );
    if (assetTypeConditionsRows.length > 0) {
      unitConditionStatesRows = await db
        .select()
        .from(unitConditionStates)
        .where(
          and(
            eq(unitConditionStates.equipmentId, equipmentId),
            eq(unitConditionStates.clinicId, clinicId),
          ),
        );
    }
  }

  const recentScans: EvidenceScanRow[] = await db
    .select({
      id: scanLogs.id,
      clinicId: scanLogs.clinicId,
      equipmentId: scanLogs.equipmentId,
      status: scanLogs.status,
      timestamp: scanLogs.timestamp,
      userEmail: scanLogs.userEmail,
    })
    .from(scanLogs)
    .where(and(eq(scanLogs.clinicId, clinicId), eq(scanLogs.equipmentId, equipmentId)))
    .orderBy(desc(scanLogs.timestamp))
    .limit(RECENT_SCAN_LIMIT);

  const recentTransfers: EvidenceTransferRow[] = await db
    .select({
      id: transferLogs.id,
      clinicId: transferLogs.clinicId,
      equipmentId: transferLogs.equipmentId,
      timestamp: transferLogs.timestamp,
      fromFolderName: transferLogs.fromFolderName,
      toFolderName: transferLogs.toFolderName,
    })
    .from(transferLogs)
    .where(and(eq(transferLogs.clinicId, clinicId), eq(transferLogs.equipmentId, equipmentId)))
    .orderBy(desc(transferLogs.timestamp))
    .limit(RECENT_TRANSFER_LIMIT);

  const recentRfidReads = await db
    .select()
    .from(equipmentRfidReads)
    .where(
      and(eq(equipmentRfidReads.clinicId, clinicId), eq(equipmentRfidReads.equipmentId, equipmentId)),
    )
    .orderBy(desc(equipmentRfidReads.readAt))
    .limit(RECENT_RFID_LIMIT);

  const recentReturns: EvidenceReturnRow[] = await db
    .select({
      id: equipmentReturns.id,
      clinicId: equipmentReturns.clinicId,
      equipmentId: equipmentReturns.equipmentId,
      returnedAt: equipmentReturns.returnedAt,
      returnedByEmail: equipmentReturns.returnedByEmail,
    })
    .from(equipmentReturns)
    .where(
      and(eq(equipmentReturns.clinicId, clinicId), eq(equipmentReturns.equipmentId, equipmentId)),
    )
    .orderBy(desc(equipmentReturns.returnedAt))
    .limit(RECENT_RETURN_LIMIT);

  const roomIds = new Set<string>();
  if (equipmentSnapshot?.roomId) roomIds.add(equipmentSnapshot.roomId);
  if (equipmentSnapshot?.lastRfidRoomId) roomIds.add(equipmentSnapshot.lastRfidRoomId);
  for (const r of recentRfidReads) {
    if (r.toRoomId) roomIds.add(r.toRoomId);
  }

  const roomsRows =
    roomIds.size > 0
      ? await db
          .select({ id: rooms.id, clinicId: rooms.clinicId, name: rooms.name })
          .from(rooms)
          .where(and(eq(rooms.clinicId, clinicId), inArray(rooms.id, [...roomIds])))
      : [];

  const activeStaging = await db
    .select()
    .from(stagingQueue)
    .where(
      and(
        eq(stagingQueue.clinicId, clinicId),
        eq(stagingQueue.equipmentId, equipmentId),
        eq(stagingQueue.status, "active"),
      ),
    );

  const waitlist =
    viewerUserId != null
      ? await buildWaitlistSnapshot(clinicId, equipmentId, viewerUserId)
      : null;

  const custodyDerived = equipmentSnapshot
    ? deriveCustodySupersessionEvents(equipmentSnapshot)
    : [];

  const supersessionEvents = mergeSupersessionEvents(
    mapSupersessionFromReturns(recentReturns),
    mapSupersessionFromTransfers(recentTransfers),
    custodyDerived,
  );

  return {
    clinicId,
    equipmentId,
    loadedAt,
    equipment: equipmentSnapshot,
    rooms: roomsRows,
    assetTypeConditions: assetTypeConditionsRows,
    unitConditionStates: unitConditionStatesRows,
    recentScans,
    recentTransfers,
    recentRfidReads,
    recentReturns,
    supersessionEvents,
    waitlist,
    activeStaging,
  };
}

/** Test helper — build an in-memory graph without DB. */
export function buildSyntheticEvidenceGraph(
  partial: Partial<EvidenceGraph> & Pick<EvidenceGraph, "clinicId" | "equipmentId">,
): EvidenceGraph {
  const equipment = partial.equipment ?? null;
  return {
    clinicId: partial.clinicId,
    equipmentId: partial.equipmentId,
    loadedAt: partial.loadedAt ?? new Date(),
    equipment,
    rooms: partial.rooms ?? [],
    assetTypeConditions: partial.assetTypeConditions ?? [],
    unitConditionStates: partial.unitConditionStates ?? [],
    recentScans: partial.recentScans ?? [],
    recentTransfers: partial.recentTransfers ?? [],
    recentRfidReads: partial.recentRfidReads ?? [],
    recentReturns: partial.recentReturns ?? [],
    supersessionEvents:
      partial.supersessionEvents ??
      mergeSupersessionEvents(
        mapSupersessionFromReturns(partial.recentReturns ?? []),
        mapSupersessionFromTransfers(partial.recentTransfers ?? []),
        equipment ? deriveCustodySupersessionEvents(equipment) : [],
      ),
    waitlist: partial.waitlist ?? null,
    activeStaging: partial.activeStaging ?? [],
  };
}
