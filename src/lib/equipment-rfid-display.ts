import type { Equipment } from "@/types";

export const RFID_SUBTITLE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RFID_ATTENTION_MAX_AGE_MS = 15 * 60 * 1000;

export function isRfidSubtitleFresh(lastRfidSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastRfidSeenAt) return false;
  const ts = new Date(lastRfidSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts <= RFID_SUBTITLE_MAX_AGE_MS;
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
