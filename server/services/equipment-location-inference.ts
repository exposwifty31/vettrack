import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, equipment, docks, rooms, scanLogs, users } from "../db.js";
import { logAudit } from "../lib/audit.js";

export type InferenceConfidence = "high" | "medium" | "low" | "unknown";
export type InferenceSignalSource = "checkout" | "dock" | "scan" | "rfid" | "none";

export interface AccountablePerson {
  userId: string;
  name: string;
  currentRoom: string | null;
}

export interface LocationInferenceResult {
  inferredLocation: string | null;
  confidence: InferenceConfidence;
  signalSource: InferenceSignalSource;
  accountablePerson: AccountablePerson | null;
  lastConfirmedAt: string | null;
  reasoning: string;
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function ageLabel(date: Date, now: Date): string {
  const ms = now.getTime() - date.getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function fetchUser(
  userId: string,
  clinicId: string,
): Promise<AccountablePerson | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
    .limit(1);
  if (!row) return null;
  return {
    userId: row.id,
    name: row.displayName || row.name,
    currentRoom: null,
  };
}

async function fetchDockWithRoom(
  dockId: string,
  clinicId: string,
): Promise<{ dockName: string; roomName: string | null } | null> {
  const [dock] = await db
    .select({ id: docks.id, name: docks.name, roomId: docks.roomId })
    .from(docks)
    .where(and(eq(docks.id, dockId), eq(docks.clinicId, clinicId)))
    .limit(1);
  if (!dock) return null;

  let roomName: string | null = null;
  if (dock.roomId) {
    const [room] = await db
      .select({ name: rooms.name })
      .from(rooms)
      .where(and(eq(rooms.id, dock.roomId), eq(rooms.clinicId, clinicId)))
      .limit(1);
    roomName = room?.name ?? null;
  }
  return { dockName: dock.name, roomName };
}

async function fetchRoomName(
  roomId: string,
  clinicId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ name: rooms.name })
    .from(rooms)
    .where(and(eq(rooms.id, roomId), eq(rooms.clinicId, clinicId)))
    .limit(1);
  return row?.name ?? null;
}

async function fetchLatestScan(
  equipmentId: string,
  clinicId: string,
): Promise<{ userId: string; userEmail: string; timestamp: Date } | null> {
  const [row] = await db
    .select({ userId: scanLogs.userId, userEmail: scanLogs.userEmail, timestamp: scanLogs.timestamp })
    .from(scanLogs)
    .where(
      and(
        eq(scanLogs.equipmentId, equipmentId),
        eq(scanLogs.clinicId, clinicId),
        isNotNull(scanLogs.userId),
      ),
    )
    .orderBy(desc(scanLogs.timestamp))
    .limit(1);
  return row ?? null;
}

export async function inferEquipmentLocation(
  equipmentId: string,
  clinicId: string,
  actorUserId: string,
  actorUserEmail: string,
): Promise<LocationInferenceResult | null> {
  const [eq_row] = await db
    .select({
      id: equipment.id,
      checkedOutById: equipment.checkedOutById,
      checkedOutAt: equipment.checkedOutAt,
      checkedOutLocation: equipment.checkedOutLocation,
      dockId: equipment.dockId,
      dockConfirmedReadyAt: equipment.dockConfirmedReadyAt,
      dockConfirmedById: equipment.dockConfirmedById,
      lastRfidSeenAt: equipment.lastRfidSeenAt,
      lastRfidRoomId: equipment.lastRfidRoomId,
      custodyState: equipment.custodyState,
      name: equipment.name,
    })
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)))
    .limit(1);

  if (!eq_row) return null;

  const now = new Date();

  // Priority 1: Active checkout
  if (eq_row.checkedOutById && eq_row.checkedOutAt) {
    const person = await fetchUser(eq_row.checkedOutById, clinicId);
    const personLabel = person?.name ?? "A staff member";
    return {
      inferredLocation: eq_row.checkedOutLocation ?? null,
      confidence: "high",
      signalSource: "checkout",
      accountablePerson: person,
      lastConfirmedAt: eq_row.checkedOutAt.toISOString(),
      reasoning: `${personLabel} has active custody (checked out ${ageLabel(eq_row.checkedOutAt, now)})`,
    };
  }

  // Priority 2: Docked
  if (eq_row.dockId && eq_row.dockConfirmedReadyAt) {
    const dockInfo = await fetchDockWithRoom(eq_row.dockId, clinicId);
    const locationParts = [dockInfo?.dockName, dockInfo?.roomName].filter(Boolean);
    const inferredLocation = locationParts.length > 0 ? locationParts.join(" – ") : null;

    const ageMs = now.getTime() - eq_row.dockConfirmedReadyAt.getTime();
    const confidence: InferenceConfidence =
      ageMs < FOUR_HOURS_MS ? "high" : ageMs < TWELVE_HOURS_MS ? "medium" : "low";

    let person: AccountablePerson | null = null;
    if (eq_row.dockConfirmedById) {
      person = await fetchUser(eq_row.dockConfirmedById, clinicId);
    }

    return {
      inferredLocation,
      confidence,
      signalSource: "dock",
      accountablePerson: person,
      lastConfirmedAt: eq_row.dockConfirmedReadyAt.toISOString(),
      reasoning: `Device is docked at ${inferredLocation ?? "known dock"} (confirmed ${ageLabel(eq_row.dockConfirmedReadyAt, now)})`,
    };
  }

  // Priority 3: Last scan (within 8 h)
  const latestScan = await fetchLatestScan(equipmentId, clinicId);
  if (latestScan) {
    const ageMs = now.getTime() - latestScan.timestamp.getTime();
    if (ageMs < EIGHT_HOURS_MS) {
      const person = await fetchUser(latestScan.userId, clinicId);
      const personLabel = person?.name ?? latestScan.userEmail;
      return {
        inferredLocation: null,
        confidence: "medium",
        signalSource: "scan",
        accountablePerson: person,
        lastConfirmedAt: latestScan.timestamp.toISOString(),
        reasoning: `Last scanned by ${personLabel} ${ageLabel(latestScan.timestamp, now)}`,
      };
    }
  }

  // Priority 4: RFID
  if (eq_row.lastRfidSeenAt && eq_row.lastRfidRoomId) {
    const roomName = await fetchRoomName(eq_row.lastRfidRoomId, clinicId);
    return {
      inferredLocation: roomName,
      confidence: "low",
      signalSource: "rfid",
      accountablePerson: null,
      lastConfirmedAt: eq_row.lastRfidSeenAt.toISOString(),
      reasoning: `RFID reader detected device in ${roomName ?? "unknown room"} ${ageLabel(eq_row.lastRfidSeenAt, now)}`,
    };
  }

  // Priority 5: No signal
  logAudit({
    clinicId,
    actionType: "equipment_location_unknown",
    performedBy: actorUserId,
    performedByEmail: actorUserEmail,
    targetId: equipmentId,
    targetType: "equipment",
    metadata: { equipmentName: eq_row.name },
  });

  return {
    inferredLocation: null,
    confidence: "unknown",
    signalSource: "none",
    accountablePerson: null,
    lastConfirmedAt: null,
    reasoning: "No location signal available — device has not been scanned, docked, checked out, or seen by RFID",
  };
}
