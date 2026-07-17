import type { Equipment } from "@/types";

export const RFID_SUBTITLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RFID_ATTENTION_MAX_AGE_MS = 15 * 60 * 1000;

export function isRfidSubtitleFresh(lastRfidSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastRfidSeenAt) return false;
  const ts = new Date(lastRfidSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts <= RFID_SUBTITLE_MAX_AGE_MS;
}

/**
 * A resolvable directional RFID movement — the origin (`fromRoomName`) and the
 * destination (`toRoomName`) of the most recent gate crossing. DISPLAY ONLY:
 * this never overrides an authoritative room (R-M1.0 precedence) and never
 * mutates custody (R-M1 non-goal).
 */
export interface RfidDirection {
  fromRoomName: string;
  toRoomName: string;
}

/**
 * Resolve the directional last-seen for the equipment-list subtitle / detail
 * card. Returns a from→to pair ONLY when the read is fresh (the same
 * `RFID_SUBTITLE_MAX_AGE_MS` gate as the plain last-seen line) AND both an
 * origin and a destination room resolved. A non-directional / legacy read (no
 * origin room) returns `null`, so callers fall back to the plain "last seen
 * near {room}" line — the legacy display is preserved byte-for-byte.
 */
export function getRfidDirection(
  eq: Pick<Equipment, "lastRfidSeenAt" | "lastRfidRoomName" | "lastRfidFromRoomName">,
  now = Date.now(),
): RfidDirection | null {
  if (!isRfidSubtitleFresh(eq.lastRfidSeenAt, now)) return null;
  const toRoomName = eq.lastRfidRoomName?.trim();
  if (!toRoomName) return null;
  const fromRoomName = eq.lastRfidFromRoomName?.trim();
  if (!fromRoomName) return null;
  return { fromRoomName, toRoomName };
}

/** Pure UI hint: checked out + fresh RFID at a dock/equipment-storage room. */
export function shouldShowRfidAttentionBadge(
  eq: Pick<
    Equipment,
    | "custodyState"
    | "lastRfidSeenAt"
    | "lastRfidRoomIsDock"
    | "lastRfidRoomName"
    | "checkedOutByEmail"
  >,
  now = Date.now(),
): boolean {
  if (eq.custodyState !== "checked_out") return false;
  if (!eq.lastRfidSeenAt || !eq.lastRfidRoomIsDock) return false;
  const ts = new Date(eq.lastRfidSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  if (now - ts > RFID_ATTENTION_MAX_AGE_MS) return false;
  return Boolean(eq.lastRfidRoomName?.trim());
}
