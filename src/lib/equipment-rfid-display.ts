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
 * A resolvable directional RFID movement derived from ONE gate crossing (the
 * latest read). `exited` carries both the origin (`fromRoomName`) and the
 * destination (`toRoomName`); `entered` carries only the destination — the
 * crossing had no resolvable origin room (M1.2c "entered from external" or a
 * first-ever read). DISPLAY ONLY: this never overrides an authoritative room
 * (R-M1.0 precedence) and never mutates custody (R-M1 non-goal).
 */
export type RfidDirection =
  | { kind: "exited"; fromRoomName: string; toRoomName: string }
  | { kind: "entered"; toRoomName: string };

/**
 * Resolve the directional last-seen for the equipment-list subtitle / detail
 * card. Both endpoints come from the SAME latest read (the server projection
 * pairs `lastRfidFromRoomName` with `lastRfidRoomName` off one crossing), so a
 * fresh read with a resolved origin is an `exited` from→to pair and a fresh read
 * whose origin was NULL is an `entered {to}` line. Returns `null` only when the
 * read is stale (the same `RFID_SUBTITLE_MAX_AGE_MS` gate as the plain last-seen
 * line) or no destination resolved, so callers fall back to the plain "last seen
 * near {room}" line.
 */
export function getRfidDirection(
  eq: Pick<Equipment, "lastRfidSeenAt" | "lastRfidRoomName" | "lastRfidFromRoomName">,
  now = Date.now(),
): RfidDirection | null {
  if (!isRfidSubtitleFresh(eq.lastRfidSeenAt, now)) return null;
  const toRoomName = eq.lastRfidRoomName?.trim();
  if (!toRoomName) return null;
  const fromRoomName = eq.lastRfidFromRoomName?.trim();
  if (fromRoomName) return { kind: "exited", fromRoomName, toRoomName };
  return { kind: "entered", toRoomName };
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
