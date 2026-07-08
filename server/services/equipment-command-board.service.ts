import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, docks, equipment, equipmentWaitlist, rooms, stagingQueue } from "../db.js";
import type {
  EquipmentBoardAlert,
  EquipmentBoardDocksBlock,
  EquipmentBoardLocationRow,
  EquipmentBoardPowerBlock,
  EquipmentBoardStagingBlock,
  EquipmentBoardTypeRow,
  EquipmentBoardUnitRow,
  EquipmentBoardWaitlistBlock,
  EquipmentCommandBoardSnapshot,
  EquipmentReadinessStatus,
} from "../../shared/equipment-board.js";
import { isEquipmentFullyDeployable } from "./equipment-operational-state.service.js";
import { getReadinessRules } from "./equipment-readiness-rules.service.js";

export type BuildCommandBoardSnapshotFn = (params: {
  clinicId: string;
}) => Promise<EquipmentCommandBoardSnapshot>;

function deriveReadinessStatus(row: {
  checkedOutAt: Date | null;
  custodyState: string;
  readinessState: string;
  usageState: string;
  status: string;
  lastSeen: Date | null;
}): EquipmentReadinessStatus {
  if (row.status === "critical" && row.usageState === "emergency_use") return "in_use";
  if (!isEquipmentFullyDeployable(row.custodyState, row.readinessState, row.usageState)) {
    if (row.readinessState === "not_ready" || row.usageState !== "available") return "blocked";
    return "unknown";
  }
  if (row.checkedOutAt) return "in_use";
  return "ready";
}

/**
 * Aggregates critical units by room for the board's by-location breakdown.
 * Pure transform of the already-fetched rows — NO additional query. Keyed by
 * roomId (room names are not unique), so distinct rooms sharing a name stay
 * separate; room-less units bucket under "__unassigned__" with an empty
 * locationName the client localizes. Critical units only, matching overview /
 * byType and the totalCritical field.
 */
export function aggregateByLocation(
  rows: Array<{ id: string; roomId: string | null; roomName: string | null }>,
  criticalUnits: EquipmentBoardUnitRow[],
): EquipmentBoardLocationRow[] {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const byLocationMap = new Map<string, EquipmentBoardLocationRow>();
  for (const unit of criticalUnits) {
    const row = rowById.get(unit.equipmentId);
    const locKey = row?.roomId ?? "__unassigned__";
    const loc = byLocationMap.get(locKey) ?? {
      locationId: row?.roomId ?? undefined,
      locationName: row?.roomName ?? "",
      totalCritical: 0,
      ready: 0,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
    };
    loc.totalCritical += 1;
    if (unit.status === "ready") loc.ready += 1;
    else if (unit.status === "in_use") loc.inUse += 1;
    else if (unit.status === "blocked") loc.blocked += 1;
    else if (unit.status === "stale") loc.stale += 1;
    else if (unit.status === "overdue") loc.overdue += 1;
    else loc.unknown += 1;
    byLocationMap.set(locKey, loc);
  }
  return [...byLocationMap.values()];
}

/**
 * Wraps an enrichment-block query so a failure degrades ONLY that block to
 * undefined. This is the load-bearing guarantee: because it never throws,
 * Promise.all can only reject on the load-bearing main query — the 2500ms
 * timeout envelope + legacy-list fallback never trip on a cosmetic aggregate.
 */
export async function safeBlock<T>(query: () => Promise<T>): Promise<T | undefined> {
  try {
    return await query();
  } catch {
    return undefined;
  }
}

/**
 * Power posture across the clinic, from the LATEST return per equipment. The
 * returns log is append-only, so the newest row per equipment needs DISTINCT ON
 * (raw sql). Filters vt_equipment_returns' OWN clinic_id — power must NOT inherit
 * tenancy from an equipment join (cross-tenant leak).
 */
async function queryPower(clinicId: string): Promise<EquipmentBoardPowerBlock> {
  const result = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE latest.is_plugged_in) AS plugged,
      count(*) FILTER (WHERE NOT latest.is_plugged_in AND latest.plug_in_alert_sent_at IS NULL) AS unplugged,
      count(*) FILTER (WHERE NOT latest.is_plugged_in AND latest.plug_in_alert_sent_at IS NOT NULL) AS alert
    FROM (
      SELECT DISTINCT ON (equipment_id) is_plugged_in, plug_in_alert_sent_at
      FROM vt_equipment_returns
      WHERE clinic_id = ${clinicId}
      ORDER BY equipment_id, returned_at DESC
    ) latest
  `);
  const row = (result as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
  return {
    plugged: Number(row?.plugged ?? 0),
    unplugged: Number(row?.unplugged ?? 0),
    alert: Number(row?.alert ?? 0),
  };
}

/** Dock capacity (vt_docks) + occupancy (vt_equipment.dock_id / dock_confirmed_ready_at). */
async function queryDocks(clinicId: string): Promise<EquipmentBoardDocksBlock> {
  const totalRows = await db.select({ n: count() }).from(docks).where(eq(docks.clinicId, clinicId));
  const occRows = await db
    .select({
      occupied: count(),
      ready: sql<number>`count(*) FILTER (WHERE ${equipment.dockConfirmedReadyAt} IS NOT NULL)`,
    })
    .from(equipment)
    .where(
      and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt), isNotNull(equipment.dockId)),
    );
  return {
    total: Number(totalRows[0]?.n ?? 0),
    occupied: Number(occRows[0]?.occupied ?? 0),
    ready: Number(occRows[0]?.ready ?? 0),
  };
}

/** Active-waitlist depth. */
async function queryWaitlist(clinicId: string): Promise<EquipmentBoardWaitlistBlock> {
  const rows = await db
    .select({ n: count() })
    .from(equipmentWaitlist)
    .where(
      and(
        eq(equipmentWaitlist.clinicId, clinicId),
        inArray(equipmentWaitlist.status, ["waiting", "notified"]),
      ),
    );
  return { depth: Number(rows[0]?.n ?? 0) };
}

/** Active staging-queue depth. */
async function queryStaging(clinicId: string): Promise<EquipmentBoardStagingBlock> {
  const rows = await db
    .select({ n: count() })
    .from(stagingQueue)
    .where(and(eq(stagingQueue.clinicId, clinicId), eq(stagingQueue.status, "active")));
  return { depth: Number(rows[0]?.n ?? 0) };
}

/** The four enrichment aggregates, injectable so degradation is exercisable in tests. */
export type BoardAggregateFns = {
  power: (clinicId: string) => Promise<EquipmentBoardPowerBlock | undefined>;
  docks: (clinicId: string) => Promise<EquipmentBoardDocksBlock | undefined>;
  waitlist: (clinicId: string) => Promise<EquipmentBoardWaitlistBlock | undefined>;
  staging: (clinicId: string) => Promise<EquipmentBoardStagingBlock | undefined>;
};

export const defaultBoardAggregates: BoardAggregateFns = {
  power: (clinicId) => safeBlock(() => queryPower(clinicId)),
  docks: (clinicId) => safeBlock(() => queryDocks(clinicId)),
  waitlist: (clinicId) => safeBlock(() => queryWaitlist(clinicId)),
  staging: (clinicId) => safeBlock(() => queryStaging(clinicId)),
};

/** Builds equipment command board snapshot (critical rows, overview, alerts, utilization signals). */
export const buildCommandBoardSnapshot: BuildCommandBoardSnapshotFn = async (
  params,
  aggregates: BoardAggregateFns = defaultBoardAggregates,
) => {
  const { clinicId } = params;
  const now = new Date();

  const rowsQuery = db
    .select({
      id: equipment.id,
      name: equipment.name,
      status: equipment.status,
      assetTypeId: equipment.assetTypeId,
      checkedOutAt: equipment.checkedOutAt,
      custodyState: equipment.custodyState,
      readinessState: equipment.readinessState,
      usageState: equipment.usageState,
      lastSeen: equipment.lastSeen,
      roomName: rooms.name,
      roomId: equipment.roomId,
    })
    .from(equipment)
    .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
    .where(
      and(
        eq(equipment.clinicId, clinicId),
        isNull(equipment.deletedAt),
        inArray(equipment.status, ["critical", "issue", "needs_attention"]),
      ),
    );

  // Phase 5 (C2) — enrichment aggregates run CONCURRENTLY with the main query
  // (latency = max, not sum). Each degrades to undefined on its own failure
  // (safeBlock), so Promise.all only rejects on the load-bearing
  // getReadinessRules / rows query — the 2500ms timeout envelope is unchanged.
  const [rules, rows, power, docks, waitlist, staging] = await Promise.all([
    getReadinessRules(clinicId),
    rowsQuery,
    aggregates.power(clinicId),
    aggregates.docks(clinicId),
    aggregates.waitlist(clinicId),
    aggregates.staging(clinicId),
  ]);

  const staleCutoff = new Date(now.getTime() - rules.staleEvidenceMs);

  const criticalUnits: EquipmentBoardUnitRow[] = rows.map((row) => {
    const status = deriveReadinessStatus(row);
    const stale =
      row.lastSeen != null
        ? row.lastSeen < staleCutoff
        : true;
    const resolvedStatus: EquipmentReadinessStatus = stale && status === "ready" ? "stale" : status;
    return {
      equipmentId: row.id,
      displayName: row.name,
      status: resolvedStatus,
      locationName: row.roomName ?? undefined,
      lastEvidenceAt: row.lastSeen?.toISOString(),
      blockingReasons:
        resolvedStatus === "blocked" ? [`readiness:${row.readinessState}`] : [],
      citationsCount: 0,
      truthHref: `/api/equipment/${row.id}/truth`,
    };
  });

  const overview = {
    totalCritical: criticalUnits.length,
    ready: criticalUnits.filter((u) => u.status === "ready").length,
    inUse: criticalUnits.filter((u) => u.status === "in_use").length,
    blocked: criticalUnits.filter((u) => u.status === "blocked").length,
    stale: criticalUnits.filter((u) => u.status === "stale").length,
    overdue: criticalUnits.filter((u) => u.status === "overdue").length,
    unknown: criticalUnits.filter((u) => u.status === "unknown").length,
    belowThresholdTypes: 0,
    activeEmergencyUnits: criticalUnits.filter((u) => u.status === "in_use").length,
  };

  const byTypeMap = new Map<string, EquipmentBoardTypeRow>();
  for (const unit of criticalUnits) {
    const typeName = rows.find((r) => r.id === unit.equipmentId)?.assetTypeId ?? "uncategorized";
    const key = String(typeName);
    const existing = byTypeMap.get(key) ?? {
      typeName: key,
      total: 0,
      ready: 0,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowMinimumReady: false,
    };
    existing.total += 1;
    if (unit.status === "ready") existing.ready += 1;
    else if (unit.status === "in_use") existing.inUse += 1;
    else if (unit.status === "blocked") existing.blocked += 1;
    else if (unit.status === "stale") existing.stale += 1;
    else if (unit.status === "overdue") existing.overdue += 1;
    else existing.unknown += 1;
    const minReady = rules.minimumReadyByType[key];
    if (typeof minReady === "number" && existing.ready < minReady) {
      existing.belowMinimumReady = true;
      existing.minimumReady = minReady;
    }
    byTypeMap.set(key, existing);
  }

  const alerts: EquipmentBoardAlert[] = [];
  for (const unit of criticalUnits) {
    if (unit.status === "blocked") {
      alerts.push({
        id: `blocked:${unit.equipmentId}`,
        type: "critical_unit_blocked",
        severity: "critical",
        equipmentId: unit.equipmentId,
        message: `${unit.displayName} is blocked`,
        recommendedAction: "open_detail",
      });
    } else if (unit.status === "stale") {
      alerts.push({
        id: `stale:${unit.equipmentId}`,
        type: "critical_unit_stale",
        severity: "warning",
        equipmentId: unit.equipmentId,
        message: `${unit.displayName} has stale evidence`,
        recommendedAction: "confirm_location",
      });
    }
  }

  overview.belowThresholdTypes = [...byTypeMap.values()].filter((t) => t.belowMinimumReady).length;

  const utilizationScore = (unit: EquipmentBoardUnitRow) =>
    (unit.status === "in_use" ? 3 : 0) + (unit.status === "ready" ? 1 : 0);

  const sortedByUtil = [...criticalUnits].sort(
    (a, b) => utilizationScore(b) - utilizationScore(a),
  );

  return {
    generatedAt: now.toISOString(),
    clinicId,
    overview,
    byType: [...byTypeMap.values()],
    byLocation: aggregateByLocation(rows, criticalUnits),
    criticalUnits,
    alerts,
    power,
    docks,
    waitlist,
    staging,
    roiSignals: {
      overusedUnits: sortedByUtil.slice(0, 5),
      underusedUnits: sortedByUtil.slice(-5).reverse(),
      repairReplaceCandidates: criticalUnits.filter((u) => u.status === "blocked"),
      typeShortages: [...byTypeMap.values()].filter((t) => t.belowMinimumReady),
      duplicatePurchaseRisks: [],
    },
  };
};
