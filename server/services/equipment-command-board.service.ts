import { and, count, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  docks,
  equipment,
  equipmentRfidReads,
  equipmentWaitlist,
  rfidEgressSignals,
  rfidReaders,
  rooms,
  stagingQueue,
} from "../db.js";
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
import {
  BATTERY_CRITICAL_PERCENT,
  getReadinessRules,
} from "./equipment-readiness-rules.service.js";
import {
  deriveBoardAnomalies,
  type ReaderAnomalySource,
} from "./board-anomaly-rules.js";
import { resolveReaderStalenessThresholdMs } from "../lib/rfid/reader-offline-sweep.js";
import { withTimeout } from "../lib/with-timeout.js";

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

// ── R-M1.3 · RFID board surfacing (advisory-only; ADR-006) ────────────────────
// RFID NEVER becomes the resolved location and NEVER mutates custody — the human-confirmed
// room (equipment.roomId) stays authoritative (M1.0). This transform derives the additive
// unit.rfid block + conflict/offline/egress signals. Pure (no DB) so every pinned branch is
// exercisable without a database, mirroring aggregateByLocation.

export type BoardRfidReaderInfo = {
  id: string;
  /** "active" | "inactive" — an inactive (deactivated) reader is excluded from live status. */
  status: string;
  /** "healthy" | "offline" | "unknown" — only an ACTIVE + offline reader raises the alert. */
  readerHealthStatus: string;
  name: string | null;
  /** R-BDF-1.1 — the reader's OWN heartbeat, sole input to the rfid_reader_offline anomaly since/age. */
  lastReaderHeartbeatAt?: Date | null;
};

export type BoardRfidUnitInput = {
  equipmentId: string;
  displayName: string;
  /** The human-confirmed room (authoritative). RFID may corroborate but never overrides it. */
  humanRoomId: string | null;
  lastRfidSeenAt: Date | null;
  lastRfidRoomId: string | null;
  lastRfidRoomName: string | null;
  lastRfidGatewayCode: string | null;
  /** Recent reads within the ambiguity window (for the >=2-simultaneous-rooms check). */
  recentReads: Array<{ toRoomId: string; readAt: Date }>;
  /** detectedAt of the most recent possible_egress signal, if any. */
  latestEgressAt: Date | null;
};

export type UnitRfidDerivation = {
  rfid?: NonNullable<EquipmentBoardUnitRow["rfid"]>;
  evidenceConflict?: EquipmentBoardUnitRow["evidenceConflict"];
  alerts: EquipmentBoardAlert[];
};

/** ≥2 DISTINCT candidate rooms sharing the latest read instant = no single winner = ambiguous. */
function hasAmbiguousCandidateRooms(reads: Array<{ toRoomId: string; readAt: Date }>): boolean {
  if (reads.length < 2) return false;
  let maxAt = -Infinity;
  for (const r of reads) maxAt = Math.max(maxAt, r.readAt.getTime());
  const roomsAtMax = new Set(reads.filter((r) => r.readAt.getTime() === maxAt).map((r) => r.toRoomId));
  return roomsAtMax.size >= 2;
}

/**
 * Derive the additive RFID surfacing for one board unit. Fires each bounded enum DISTINCTLY:
 *  - locationKind: 'room' | 'external_zone' (post-egress) | 'unresolved' (no resolvable room).
 *  - rfid_location_conflict: a SINGLE recent read disagrees with the human room.
 *  - ambiguous_rfid_location: ≥2 simultaneous candidate rooms (takes precedence over conflict).
 *  - rfid_reader_offline: the last reader is ACTIVE + stale (deactivated readers are excluded).
 *  - possible_egress: a recent boundary/dock exit toward the external (NULL) endpoint.
 */
export function deriveUnitRfid(
  input: BoardRfidUnitInput,
  readerByGateway: Map<string, BoardRfidReaderInfo>,
): UnitRfidDerivation {
  const alerts: EquipmentBoardAlert[] = [];
  if (input.lastRfidSeenAt == null) {
    return { alerts };
  }

  const reader = input.lastRfidGatewayCode
    ? readerByGateway.get(input.lastRfidGatewayCode)
    : undefined;
  // Reader removed AFTER a valid read => readerId=null (last-seen room still shown, no link).
  const readerId = reader ? reader.id : null;

  const isExternal =
    input.latestEgressAt != null &&
    input.latestEgressAt.getTime() >= input.lastRfidSeenAt.getTime();
  const locationKind: "room" | "external_zone" | "unresolved" = isExternal
    ? "external_zone"
    : input.lastRfidRoomId == null
      ? "unresolved"
      : "room";

  const isAmbiguous = hasAmbiguousCandidateRooms(input.recentReads);
  const isSingleConflict =
    !isAmbiguous &&
    input.humanRoomId != null &&
    input.lastRfidRoomId != null &&
    input.lastRfidRoomId !== input.humanRoomId;

  const confidence: "low" | "medium" | "high" = isAmbiguous
    ? "low"
    : locationKind === "room"
      ? "high"
      : locationKind === "external_zone"
        ? "medium"
        : "low";

  const rfid: NonNullable<EquipmentBoardUnitRow["rfid"]> = {
    lastSeenAt: input.lastRfidSeenAt.toISOString(),
    readerId,
    readerName: reader?.name ?? undefined,
    locationId: input.lastRfidRoomId ?? undefined,
    locationName: input.lastRfidRoomName ?? undefined,
    locationKind,
    confidence,
    readsInWindow: input.recentReads.length > 0 ? input.recentReads.length : undefined,
  };

  let evidenceConflict: EquipmentBoardUnitRow["evidenceConflict"];
  if (isAmbiguous) {
    evidenceConflict = {
      type: "ambiguous_rfid_location",
      action: "confirm_location",
      message: `${input.displayName} has conflicting RFID locations`,
    };
    alerts.push({
      id: `ambiguous_rfid_location:${input.equipmentId}`,
      type: "ambiguous_rfid_location",
      severity: "warning",
      equipmentId: input.equipmentId,
      message: `${input.displayName} has conflicting RFID locations`,
      recommendedAction: "confirm_location",
    });
  } else if (isSingleConflict) {
    evidenceConflict = {
      type: "rfid_location_conflict",
      action: "confirm_location",
      message: `${input.displayName} RFID last-seen disagrees with its confirmed room`,
    };
    alerts.push({
      id: `rfid_location_conflict:${input.equipmentId}`,
      type: "rfid_location_conflict",
      severity: "warning",
      equipmentId: input.equipmentId,
      message: `${input.displayName} RFID last-seen disagrees with its confirmed room`,
      recommendedAction: "confirm_location",
    });
  }

  // Deactivated readers are excluded from live status; only an ACTIVE + offline reader alerts.
  if (reader && reader.status === "active" && reader.readerHealthStatus === "offline") {
    alerts.push({
      id: `rfid_reader_offline:${input.equipmentId}`,
      type: "rfid_reader_offline",
      severity: "warning",
      equipmentId: input.equipmentId,
      message: `RFID reader for ${input.displayName} is offline`,
      recommendedAction: "open_detail",
    });
  }

  if (isExternal) {
    alerts.push({
      id: `possible_egress:${input.equipmentId}`,
      type: "possible_egress",
      severity: "warning",
      equipmentId: input.equipmentId,
      message: `${input.displayName} may have left the clinic`,
      recommendedAction: "open_detail",
    });
  }

  return { rfid, evidenceConflict, alerts };
}

/**
 * Wraps an enrichment-block query so a THROWN failure degrades ONLY that block to
 * undefined (never rethrows). Slowness is bounded separately by the per-aggregate
 * withTimeout in defaultBoardAggregates — together they keep a cosmetic aggregate,
 * whether it fails OR hangs, from tripping the 2500ms envelope / legacy fallback.
 */
export async function safeBlock<T>(query: () => Promise<T>): Promise<T | undefined> {
  try {
    return await query();
  } catch (err) {
    // Degrade gracefully but NOT silently — the caught error's stack names the
    // failing queryX, so a persistently-broken aggregate is observable in the
    // logs instead of surfacing only as an invisibly missing panel.
    console.warn("[command-board] enrichment aggregate failed; degrading block to undefined", err);
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
  // db.execute() returns a generic Drizzle QueryResult whose row shape is not
  // inferable from a raw sql`` string, so the `rows` shape is asserted here on
  // purpose (fields coerced individually with Number() below). Intentional cast.
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

// Each aggregate is bounded on BOTH axes: safeBlock catches a throw, and
// withTimeout(AGGREGATE_TIMEOUT_MS) caps latency — so a slow query (notably the
// power DISTINCT ON, whose returned_at sort is unindexed at scale) degrades to
// undefined instead of eating the shared 2500ms snapshot budget. The cap sits well
// under the envelope, so an aggregate can never dominate it.
const AGGREGATE_TIMEOUT_MS = 1500;

export const defaultBoardAggregates: BoardAggregateFns = {
  power: (clinicId) => safeBlock(() => withTimeout(queryPower(clinicId), AGGREGATE_TIMEOUT_MS)),
  docks: (clinicId) => safeBlock(() => withTimeout(queryDocks(clinicId), AGGREGATE_TIMEOUT_MS)),
  waitlist: (clinicId) => safeBlock(() => withTimeout(queryWaitlist(clinicId), AGGREGATE_TIMEOUT_MS)),
  staging: (clinicId) => safeBlock(() => withTimeout(queryStaging(clinicId), AGGREGATE_TIMEOUT_MS)),
};

// R-M1.3 — reads within this window feed the ambiguity check (≥2 simultaneous candidate rooms).
const RFID_AMBIGUITY_WINDOW_MS = 5 * 60 * 1000;

/**
 * R-BDF-1.1 — process-local VOLATILE onset store for `battery_critical`, partitioned per clinic
 * (battery has no snapshot onset, so its `since` is the absent→active transition time). Volatile
 * by design: a fresh process / scale-out instance re-anchors `since` to the current observation —
 * an advisory glance hint, not an SLA clock. Per-clinic so one clinic's pass never evicts another's
 * onset keys. R-BDF-1.2 builds the fuller single-shot state machine on this seam.
 */
const batteryCriticalOnsetByClinic = new Map<string, Map<string, string>>();

function getBatteryOnsetStore(clinicId: string): Map<string, string> {
  let store = batteryCriticalOnsetByClinic.get(clinicId);
  if (!store) {
    store = new Map<string, string>();
    batteryCriticalOnsetByClinic.set(clinicId, store);
  }
  return store;
}

/** Managed readers for the clinic, keyed by gatewayCode (includes inactive/deactivated). */
async function queryRfidReaders(clinicId: string): Promise<Map<string, BoardRfidReaderInfo>> {
  const rows = await db
    .select({
      id: rfidReaders.id,
      gatewayCode: rfidReaders.gatewayCode,
      status: rfidReaders.status,
      readerHealthStatus: rfidReaders.readerHealthStatus,
      name: rfidReaders.name,
      lastReaderHeartbeatAt: rfidReaders.lastReaderHeartbeatAt,
    })
    .from(rfidReaders)
    .where(eq(rfidReaders.clinicId, clinicId));
  const map = new Map<string, BoardRfidReaderInfo>();
  for (const r of rows) {
    map.set(r.gatewayCode, {
      id: r.id,
      status: r.status,
      readerHealthStatus: r.readerHealthStatus,
      name: r.name,
      lastReaderHeartbeatAt: r.lastReaderHeartbeatAt,
    });
  }
  return map;
}

/** Latest possible_egress detectedAt per equipment (the exit-toward-external signal, R-M1.2c). */
async function queryLatestEgress(
  clinicId: string,
  equipmentIds: string[],
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (equipmentIds.length === 0) return map;
  const rows = await db
    .select({
      equipmentId: rfidEgressSignals.equipmentId,
      detectedAt: sql<Date>`max(${rfidEgressSignals.detectedAt})`,
    })
    .from(rfidEgressSignals)
    .where(
      and(
        eq(rfidEgressSignals.clinicId, clinicId),
        inArray(rfidEgressSignals.equipmentId, equipmentIds),
      ),
    )
    .groupBy(rfidEgressSignals.equipmentId);
  for (const r of rows) {
    if (r.detectedAt) map.set(r.equipmentId, new Date(r.detectedAt));
  }
  return map;
}

/** Recent reads per equipment within the ambiguity window, for the ≥2-simultaneous-rooms check. */
async function queryRecentReads(
  clinicId: string,
  equipmentIds: string[],
  now: Date,
): Promise<Map<string, Array<{ toRoomId: string; readAt: Date }>>> {
  const map = new Map<string, Array<{ toRoomId: string; readAt: Date }>>();
  if (equipmentIds.length === 0) return map;
  const windowStart = new Date(now.getTime() - RFID_AMBIGUITY_WINDOW_MS);
  const rows = await db
    .select({
      equipmentId: equipmentRfidReads.equipmentId,
      toRoomId: equipmentRfidReads.toRoomId,
      readAt: equipmentRfidReads.readAt,
    })
    .from(equipmentRfidReads)
    .where(
      and(
        eq(equipmentRfidReads.clinicId, clinicId),
        inArray(equipmentRfidReads.equipmentId, equipmentIds),
        gte(equipmentRfidReads.readAt, windowStart),
      ),
    );
  for (const r of rows) {
    const list = map.get(r.equipmentId) ?? [];
    list.push({ toRoomId: r.toRoomId, readAt: new Date(r.readAt) });
    map.set(r.equipmentId, list);
  }
  return map;
}

/** Builds equipment command board snapshot (critical rows, overview, alerts, utilization signals). */
export const buildCommandBoardSnapshot: BuildCommandBoardSnapshotFn = async (
  params,
  aggregates: BoardAggregateFns = defaultBoardAggregates,
) => {
  const { clinicId } = params;
  const now = new Date();

  // R-M1.3 — resolve the RFID last-seen room NAME via a second (clinic-scoped) rooms join so a
  // since-deleted room surfaces as NULL (=> locationKind 'unresolved') without failing the join.
  const rfidRooms = alias(rooms, "rfid_rooms");

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
      lastRfidSeenAt: equipment.lastRfidSeenAt,
      lastRfidRoomId: equipment.lastRfidRoomId,
      lastRfidGatewayCode: equipment.lastRfidGatewayCode,
      rfidRoomName: rfidRooms.name,
    })
    .from(equipment)
    .leftJoin(rooms, and(eq(equipment.roomId, rooms.id), eq(rooms.clinicId, clinicId)))
    .leftJoin(
      rfidRooms,
      and(eq(equipment.lastRfidRoomId, rfidRooms.id), eq(rfidRooms.clinicId, clinicId)),
    )
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

  // R-M1.3 — RFID surfacing lookups. Bounded to the critical units on the board and wrapped in
  // safeBlock so a failure degrades RFID surfacing to empty (the board still renders — kiosk-safe,
  // matching the enrichment-block tolerant-reader doctrine). RFID is advisory-only: these NEVER
  // change custody and NEVER become the resolved location.
  const equipmentIds = rows.map((r) => r.id);
  const [readerByGateway, latestEgressByEquipment, recentReadsByEquipment] = await Promise.all([
    safeBlock(() => queryRfidReaders(clinicId)),
    safeBlock(() => queryLatestEgress(clinicId, equipmentIds)),
    safeBlock(() => queryRecentReads(clinicId, equipmentIds, now)),
  ]);
  const readerLookup = readerByGateway ?? new Map<string, BoardRfidReaderInfo>();
  const rfidAlerts: EquipmentBoardAlert[] = [];

  const criticalUnits: EquipmentBoardUnitRow[] = rows.map((row) => {
    const status = deriveReadinessStatus(row);
    const stale =
      row.lastSeen != null
        ? row.lastSeen < staleCutoff
        : true;
    const resolvedStatus: EquipmentReadinessStatus = stale && status === "ready" ? "stale" : status;
    const rfidDerivation = deriveUnitRfid(
      {
        equipmentId: row.id,
        displayName: row.name,
        humanRoomId: row.roomId,
        lastRfidSeenAt: row.lastRfidSeenAt,
        lastRfidRoomId: row.lastRfidRoomId,
        lastRfidRoomName: row.rfidRoomName,
        lastRfidGatewayCode: row.lastRfidGatewayCode,
        recentReads: recentReadsByEquipment?.get(row.id) ?? [],
        latestEgressAt: latestEgressByEquipment?.get(row.id) ?? null,
      },
      readerLookup,
    );
    rfidAlerts.push(...rfidDerivation.alerts);
    return {
      equipmentId: row.id,
      displayName: row.name,
      status: resolvedStatus,
      // Human-confirmed room stays the RESOLVED location (M1.0) — RFID evidence lives only in
      // the additive rfid block, never overriding locationName.
      locationName: row.roomName ?? undefined,
      lastEvidenceAt: row.lastSeen?.toISOString(),
      rfid: rfidDerivation.rfid,
      evidenceConflict: rfidDerivation.evidenceConflict,
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

  // R-M1.3 — RFID conflict / offline / egress signals (advisory; never a custody move).
  alerts.push(...rfidAlerts);

  overview.belowThresholdTypes = [...byTypeMap.values()].filter((t) => t.belowMinimumReady).length;

  const utilizationScore = (unit: EquipmentBoardUnitRow) =>
    (unit.status === "in_use" ? 3 : 0) + (unit.status === "ready" ? 1 : 0);

  const sortedByUtil = [...criticalUnits].sort(
    (a, b) => utilizationScore(b) - utilizationScore(a),
  );

  // R-BDF-1.1 — additive ambient anomaly pass over data ALREADY fetched (no new query/poll).
  // Fail-safe: deriveBoardAnomalies never throws, and each source is clinicId-filtered inside it.
  // rfid_reader_offline is fed from the reader rows already loaded above (reusing the R-M1.1d
  // single-source health computation). battery_critical / cart_unverified carry no clean per-unit
  // source in the current snapshot (no battery column; no crash-cart identity in the critical-only
  // rows) — they degrade to no anomaly (fail-safe) until their data sources are plumbed; the pass
  // supports them now so that wiring is additive-only.
  const readerAnomalySources: ReaderAnomalySource[] = [...readerLookup.values()].map((r) => ({
    clinicId,
    readerId: r.id,
    status: r.status,
    lastReaderHeartbeatAt: r.lastReaderHeartbeatAt ?? null,
  }));
  const anomalies = deriveBoardAnomalies({
    clinicId,
    now,
    batteryCriticalPercent: BATTERY_CRITICAL_PERCENT,
    readerStalenessThresholdMs: resolveReaderStalenessThresholdMs(clinicId),
    batteries: [],
    carts: [],
    readers: readerAnomalySources,
    batteryOnset: getBatteryOnsetStore(clinicId),
  });

  return {
    generatedAt: now.toISOString(),
    clinicId,
    overview,
    byType: [...byTypeMap.values()],
    byLocation: aggregateByLocation(rows, criticalUnits),
    criticalUnits,
    alerts,
    anomalies,
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
