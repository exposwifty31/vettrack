import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  alertAcks,
  auditLogs,
  billingLedger,
  db,
  equipment,
  equipmentReturns,
  equipmentWaitlist,
  rooms,
  scanLogs,
  shiftSessions,
  transferLogs,
  usageSessions,
} from "../db.js";
import { EvidenceGraphBuilder } from "./evidence-graph.js";

const MAX_EQUIPMENT = 120;
const LOOKBACK_MS = 8 * 60 * 60 * 1000;
const SCAN_LIMIT = 80;
const RETURN_LIMIT = 40;
const AUDIT_LIMIT = 40;

export interface EquipmentContextSnapshot {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  equipmentCount: number;
  openShiftSessionId: string | null;
  equipment: Array<{
    equipmentId: string;
    name: string;
    status: string;
    location: string | null;
    roomName: string | null;
    custodyState: string;
    readinessState: string;
    usageState: string;
    checkedOutById: string | null;
    checkedOutAt: string | null;
    expectedReturnMinutes: number | null;
    lastSeenAt: string | null;
    lastMaintenanceDate: string | null;
    maintenanceIntervalDays: number | null;
    expiryDate: string | null;
    riskSignals: string[];
  }>;
  metrics: {
    untrackedCount: number;
    checkedOutCount: number;
    overdueMaintenanceCount: number;
    openAlertCount: number;
    activeWaitlistCount: number;
  };
}

export interface BuiltIntelligenceContext {
  snapshot: EquipmentContextSnapshot;
  graph: ReturnType<EvidenceGraphBuilder["build"]>;
  graphBuilder: EvidenceGraphBuilder;
}

export async function buildEquipmentIntelligenceContext(
  clinicId: string,
  windowEnd: Date = new Date(),
): Promise<BuiltIntelligenceContext> {
  const windowStart = new Date(windowEnd.getTime() - LOOKBACK_MS);
  const graphBuilder = new EvidenceGraphBuilder();

  const [openSession] = await db
    .select({ id: shiftSessions.id })
    .from(shiftSessions)
    .where(and(eq(shiftSessions.clinicId, clinicId), isNull(shiftSessions.endedAt)))
    .orderBy(desc(shiftSessions.startedAt))
    .limit(1);

  const equipmentRows = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)))
    .orderBy(desc(equipment.lastSeen))
    .limit(MAX_EQUIPMENT);

  const roomRows = await db
    .select({ id: rooms.id, name: rooms.name })
    .from(rooms)
    .where(eq(rooms.clinicId, clinicId));
  const roomNameById = new Map(roomRows.map((r) => [r.id, r.name]));

  const equipmentIds = equipmentRows.map((e) => e.id);

  const recentScans =
    equipmentIds.length > 0
      ? await db
          .select()
          .from(scanLogs)
          .where(
            and(
              eq(scanLogs.clinicId, clinicId),
              gte(scanLogs.timestamp, windowStart),
              inArray(scanLogs.equipmentId, equipmentIds),
            ),
          )
          .orderBy(desc(scanLogs.timestamp))
          .limit(SCAN_LIMIT)
      : [];

  const recentReturns =
    equipmentIds.length > 0
      ? await db
          .select()
          .from(equipmentReturns)
          .where(
            and(
              eq(equipmentReturns.clinicId, clinicId),
              gte(equipmentReturns.returnedAt, windowStart),
              inArray(equipmentReturns.equipmentId, equipmentIds),
            ),
          )
          .orderBy(desc(equipmentReturns.returnedAt))
          .limit(RETURN_LIMIT)
      : [];

  const openAlerts = await db
    .select()
    .from(alertAcks)
    .where(
      and(
        eq(alertAcks.clinicId, clinicId),
        or(isNull(alertAcks.resolvedAt), eq(alertAcks.ackStatus, "SEEN")),
      ),
    )
    .limit(50);

  const waitlistRows =
    equipmentIds.length > 0
      ? await db
          .select()
          .from(equipmentWaitlist)
          .where(
            and(
              eq(equipmentWaitlist.clinicId, clinicId),
              inArray(equipmentWaitlist.status, ["waiting", "notified"]),
              inArray(equipmentWaitlist.equipmentId, equipmentIds),
            ),
          )
          .limit(50)
      : [];

  const equipmentAudits = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.clinicId, clinicId),
        gte(auditLogs.timestamp, windowStart),
        sql`${auditLogs.actionType} LIKE 'equipment_%'`,
      ),
    )
    .orderBy(desc(auditLogs.timestamp))
    .limit(AUDIT_LIMIT);

  const billingRows =
    equipmentIds.length > 0
      ? await db
          .select()
          .from(billingLedger)
          .where(
            and(
              eq(billingLedger.clinicId, clinicId),
              eq(billingLedger.itemType, "EQUIPMENT"),
              gte(billingLedger.createdAt, windowStart),
              inArray(billingLedger.itemId, equipmentIds),
            ),
          )
          .orderBy(desc(billingLedger.createdAt))
          .limit(30)
      : [];

  const openUsage =
    equipmentIds.length > 0
      ? await db
          .select()
          .from(usageSessions)
          .where(
            and(
              eq(usageSessions.clinicId, clinicId),
              eq(usageSessions.status, "open"),
              inArray(usageSessions.equipmentId, equipmentIds),
            ),
          )
          .limit(30)
      : [];

  const recentTransfers =
    equipmentIds.length > 0
      ? await db
          .select()
          .from(transferLogs)
          .where(
            and(
              eq(transferLogs.clinicId, clinicId),
              gte(transferLogs.timestamp, windowStart),
              inArray(transferLogs.equipmentId, equipmentIds),
            ),
          )
          .orderBy(desc(transferLogs.timestamp))
          .limit(30)
      : [];

  let untrackedCount = 0;
  let checkedOutCount = 0;
  let overdueMaintenanceCount = 0;
  const nowMs = windowEnd.getTime();

  const equipmentContext = equipmentRows.map((row) => {
    const riskSignals: string[] = [];
    const eqNodeId = graphBuilder.addNode({
      stableId: `equipment:${row.id}`,
      type: "equipment",
      label: row.name,
      facts: {
        status: row.status,
        custodyState: row.custodyState,
        readinessState: row.readinessState,
        usageState: row.usageState,
        location: row.location,
        roomId: row.roomId,
      },
      occurredAt: row.lastSeen,
      relatedIds: row.roomId ? [`room:${row.roomId}`] : [],
    });

    if (row.roomId) {
      const roomName = roomNameById.get(row.roomId) ?? row.roomId;
      const roomNodeId = graphBuilder.addNode({
        stableId: `room:${row.roomId}`,
        type: "room",
        label: roomName,
        facts: { roomId: row.roomId },
        occurredAt: null,
      });
      graphBuilder.link(eqNodeId, roomNodeId, "located_in");
    }

    if (row.custodyState === "untracked") {
      untrackedCount += 1;
      riskSignals.push("custody_untracked");
    }
    if (row.custodyState === "checked_out") {
      checkedOutCount += 1;
      if (row.checkedOutAt && row.expectedReturnMinutes) {
        const dueMs = row.checkedOutAt.getTime() + row.expectedReturnMinutes * 60_000;
        if (dueMs < nowMs) riskSignals.push("return_overdue");
      }
    }
    if (row.status === "overdue" || row.status === "maintenance") {
      overdueMaintenanceCount += 1;
      riskSignals.push(`status_${row.status}`);
    }
    if (row.readinessState !== "ready" && row.usageState === "available") {
      riskSignals.push("not_deployable");
    }
    if (row.expiryDate) {
      const expiryMs = new Date(row.expiryDate).getTime();
      if (expiryMs - nowMs < 7 * 24 * 60 * 60 * 1000) riskSignals.push("expiry_soon");
    }
    if (row.lastMaintenanceDate && row.maintenanceIntervalDays) {
      const nextMs =
        row.lastMaintenanceDate.getTime() + row.maintenanceIntervalDays * 24 * 60 * 60 * 1000;
      if (nextMs < nowMs) riskSignals.push("maintenance_overdue");
    }
    if (row.lastSeen) {
      const staleMs = nowMs - row.lastSeen.getTime();
      if (staleMs > 24 * 60 * 60 * 1000 && row.custodyState !== "docked") {
        riskSignals.push("stale_last_seen");
      }
    } else if (row.custodyState !== "docked") {
      riskSignals.push("never_seen");
    }

    return {
      equipmentId: row.id,
      name: row.name,
      status: row.status,
      location: row.location,
      roomName: row.roomId ? roomNameById.get(row.roomId) ?? null : null,
      custodyState: row.custodyState,
      readinessState: row.readinessState,
      usageState: row.usageState,
      checkedOutById: row.checkedOutById,
      checkedOutAt: row.checkedOutAt?.toISOString() ?? null,
      expectedReturnMinutes: row.expectedReturnMinutes,
      lastSeenAt: row.lastSeen?.toISOString() ?? null,
      lastMaintenanceDate: row.lastMaintenanceDate?.toISOString() ?? null,
      maintenanceIntervalDays: row.maintenanceIntervalDays,
      expiryDate: row.expiryDate,
      riskSignals,
    };
  });

  for (const scan of recentScans) {
    if (!scan.equipmentId) continue;
    const scanId = graphBuilder.addNode({
      type: "scan",
      label: `Scan ${scan.status}`,
      facts: { status: scan.status, equipmentId: scan.equipmentId, userEmail: scan.userEmail },
      occurredAt: scan.timestamp,
      relatedIds: [`equipment:${scan.equipmentId}`],
    });
    graphBuilder.link(scanId, `equipment:${scan.equipmentId}`, "scanned");
  }

  for (const ret of recentReturns) {
    const retId = graphBuilder.addNode({
      type: "return",
      label: "Equipment return",
      facts: {
        equipmentId: ret.equipmentId,
        isPluggedIn: ret.isPluggedIn,
        returnedByEmail: ret.returnedByEmail,
      },
      occurredAt: ret.returnedAt,
      relatedIds: [`equipment:${ret.equipmentId}`],
    });
    graphBuilder.link(retId, `equipment:${ret.equipmentId}`, "returned");
    if (!ret.isPluggedIn) {
      graphBuilder.link(retId, `equipment:${ret.equipmentId}`, "plug_in_risk");
    }
  }

  for (const alert of openAlerts) {
    const alertId = graphBuilder.addNode({
      stableId: `alert:${alert.id}`,
      type: "alert",
      label: `Alert ${alert.alertType}`,
      facts: {
        alertType: alert.alertType,
        ackStatus: alert.ackStatus,
        equipmentId: alert.equipmentId,
      },
      occurredAt: alert.acknowledgedAt,
      relatedIds: [`equipment:${alert.equipmentId}`],
    });
    graphBuilder.link(alertId, `equipment:${alert.equipmentId}`, "alert_on");
  }

  for (const wl of waitlistRows) {
    const wlId = graphBuilder.addNode({
      stableId: `waitlist:${wl.id}`,
      type: "waitlist",
      label: "Equipment waitlist",
      facts: { status: wl.status, equipmentId: wl.equipmentId, userId: wl.userId },
      occurredAt: wl.joinedAt,
      relatedIds: [`equipment:${wl.equipmentId}`],
    });
    graphBuilder.link(wlId, `equipment:${wl.equipmentId}`, "waiting_for");
  }

  for (const audit of equipmentAudits) {
    if (!audit.targetId) continue;
    const aId = graphBuilder.addNode({
      type: "audit",
      label: audit.actionType,
      facts: { actionType: audit.actionType, targetId: audit.targetId },
      occurredAt: audit.timestamp,
      relatedIds: audit.targetId.startsWith("eq_") || audit.targetId.length > 8
        ? [`equipment:${audit.targetId}`]
        : [],
    });
    if (graphBuilder.hasNode(`equipment:${audit.targetId}`)) {
      graphBuilder.link(aId, `equipment:${audit.targetId}`, "audit_target");
    }
  }

  for (const bill of billingRows) {
    const bId = graphBuilder.addNode({
      type: "billing",
      label: "Equipment billing",
      facts: { status: bill.status, itemId: bill.itemId, totalCents: bill.totalAmountCents },
      occurredAt: bill.createdAt,
      relatedIds: [`equipment:${bill.itemId}`],
    });
    if (graphBuilder.hasNode(`equipment:${bill.itemId}`)) {
      graphBuilder.link(bId, `equipment:${bill.itemId}`, "billed");
    }
  }

  for (const usage of openUsage) {
    if (!usage.equipmentId) continue;
    const uId = graphBuilder.addNode({
      type: "metric",
      label: "Open usage session",
      facts: { equipmentId: usage.equipmentId, status: usage.status },
      occurredAt: usage.startedAt,
      relatedIds: [`equipment:${usage.equipmentId}`],
    });
    graphBuilder.link(uId, `equipment:${usage.equipmentId}`, "in_use");
  }

  for (const tr of recentTransfers) {
    if (!tr.equipmentId) continue;
    const tId = graphBuilder.addNode({
      type: "transfer",
      label: "Location transfer",
      facts: {
        from: tr.fromFolderName,
        to: tr.toFolderName,
        equipmentId: tr.equipmentId,
      },
      occurredAt: tr.timestamp,
      relatedIds: [`equipment:${tr.equipmentId}`],
    });
    graphBuilder.link(tId, `equipment:${tr.equipmentId}`, "transferred");
  }

  const snapshot: EquipmentContextSnapshot = {
    generatedAt: windowEnd.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    equipmentCount: equipmentRows.length,
    openShiftSessionId: openSession?.id ?? null,
    equipment: equipmentContext,
    metrics: {
      untrackedCount,
      checkedOutCount,
      overdueMaintenanceCount,
      openAlertCount: openAlerts.length,
      activeWaitlistCount: waitlistRows.length,
    },
  };

  return { snapshot, graph: graphBuilder.build(), graphBuilder };
}
