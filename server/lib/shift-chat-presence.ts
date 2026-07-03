import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, shiftMessages, shifts } from "../db.js";
import { shiftWindowContains } from "./shift-adjustment-window.js";
import { localDateKey, windowBounds, windowSessionId } from "./shift-window.js";

// ─── In-memory presence/typing map ────────────────────────────────────────────
// Resets on server restart — presence is ephemeral by design.

interface PresenceEntry {
  name: string;
  typingUntil: number; // epoch ms
  lastSeenAt: number;  // epoch ms
}

const presenceMap = new Map<string, Map<string, PresenceEntry>>();
// shape: presenceMap.get(clinicId)?.get(userId)

const ONLINE_TTL_MS  = 5 * 60 * 1000; // 5 minutes
const TYPING_TTL_MS  = 3 * 1000;      // 3 seconds

export function touchPresence(clinicId: string, userId: string, name: string, typing = false): void {
  let clinic = presenceMap.get(clinicId);
  if (!clinic) {
    clinic = new Map();
    presenceMap.set(clinicId, clinic);
  }
  const now = Date.now();
  const existing = clinic.get(userId);
  clinic.set(userId, {
    name,
    typingUntil: typing ? now + TYPING_TTL_MS : (existing?.typingUntil ?? 0),
    lastSeenAt: now,
  });
}

export function getPresence(clinicId: string): { onlineUserIds: string[]; typing: string[] } {
  const clinic = presenceMap.get(clinicId);
  if (!clinic) return { onlineUserIds: [], typing: [] };

  const now = Date.now();
  const onlineUserIds: string[] = [];
  const typing: string[] = [];

  for (const [userId, entry] of Array.from(clinic.entries())) {
    if (now - entry.lastSeenAt >= ONLINE_TTL_MS) {
      clinic.delete(userId); // evict stale entry to prevent unbounded growth
      continue;
    }
    onlineUserIds.push(userId);
    if (entry.typingUntil > now) typing.push(entry.name);
  }

  return { onlineUserIds, typing };
}

// ─── System message auto-poster ───────────────────────────────────────────────
// Call from any server handler to post a system card to the active shift channel.
// No-op when the clinic has no active roster window.

/**
 * The clinic's current roster window id — the earliest `vt_shifts` window
 * containing `now`. System messages carry no acting user, so this is the
 * clinic-level analogue of the per-user window in shift-chat-window.ts.
 * Reads scope by createdAt, so the stamp only matters for the archive.
 */
async function resolveClinicWindowId(clinicId: string): Promise<string | null> {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const rows = await db
    .select({ date: shifts.date, startTime: shifts.startTime, endTime: shifts.endTime })
    .from(shifts)
    .where(and(
      eq(shifts.clinicId, clinicId),
      inArray(shifts.date, [localDateKey(now), localDateKey(yesterday)]),
    ));
  const active = rows.filter((r) => shiftWindowContains(now, r.date, r.startTime, r.endTime));
  if (active.length === 0) return null;
  active.sort((a, b) => windowBounds(a).startedAt.getTime() - windowBounds(b).startedAt.getTime());
  return windowSessionId(clinicId, active[0]!);
}

export async function postSystemMessage(
  clinicId: string,
  systemEventType: string,
  systemEventPayload: Record<string, unknown>,
): Promise<void> {
  try {
    const windowId = await resolveClinicWindowId(clinicId);
    if (!windowId) return; // No active roster window — silent no-op

    await db.insert(shiftMessages).values({
      id: randomUUID(),
      shiftSessionId: windowId,
      clinicId,
      senderId: null,
      senderName: null,
      senderRole: null,
      body: "",
      type: "system",
      broadcastKey: null,
      systemEventType,
      systemEventPayload,
      roomTag: null,
      isUrgent: false,
      mentionedUserIds: [],
      pinnedAt: null,
      pinnedByUserId: null,
    });
  } catch (err) {
    // Never throw — system messages are best-effort
    console.error("[shift-chat] postSystemMessage failed:", err);
  }
}
