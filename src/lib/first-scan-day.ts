import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";

/** UTC calendar day key for per-user first-scan celebration. */
export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function storageKey(userId: string, day = utcDayKey()): string {
  return `vt-first-scan-${userId}-${day}`;
}

export function hasCelebratedFirstScanToday(userId: string | null | undefined): boolean {
  if (!userId) return true;
  return safeStorageGetItem(storageKey(userId)) === "1";
}

export function markFirstScanCelebratedToday(userId: string | null | undefined): void {
  if (!userId) return;
  safeStorageSetItem(storageKey(userId), "1");
}
