import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { t } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import { toast } from "sonner";
import { isNetworkError } from "@/lib/request-core";

const NFC_TOGGLE_GUARD_PREFIX = "vt_nfc_toggle_fired:";
const NFC_TOGGLE_GUARD_TTL_MS = 8_000;

export function nfcToggleGuardKey(equipmentId: string): string {
  return `${NFC_TOGGLE_GUARD_PREFIX}${equipmentId}`;
}

export function markNfcToggleFired(equipmentId: string): void {
  try {
    sessionStorage.setItem(nfcToggleGuardKey(equipmentId), String(Date.now()));
  } catch {
    /* sessionStorage unavailable */
  }
}

export function wasNfcToggleFiredRecently(equipmentId: string): boolean {
  try {
    const raw = sessionStorage.getItem(nfcToggleGuardKey(equipmentId));
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < NFC_TOGGLE_GUARD_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * T-35 (R-SC-03): clears the 8s success guard on every `runEquipmentQuickToggle`
 * failure path (network / 409 / rethrow) so a genuine retry isn't silently
 * dropped for the remainder of the 8s window. Callers still absorb hardware
 * re-fires for the same tap via the short `NFC_REFIRE_DEBOUNCE_MS` debounce.
 */
export function clearNfcToggleFired(equipmentId: string): void {
  try {
    sessionStorage.removeItem(nfcToggleGuardKey(equipmentId));
  } catch {
    /* sessionStorage unavailable */
  }
}

/**
 * Pinned short debounce for hardware-reader re-fires (multiple `onRead` events
 * per physical tap). Deliberately distinct from the 8s `NFC_TOGGLE_GUARD_TTL_MS`
 * success guard — this only absorbs near-instant duplicate reads, not repeat
 * taps after the app has actually responded.
 */
export const NFC_REFIRE_DEBOUNCE_MS = 500;

// Logged-out NFC scan toast guard. Mirrors the toggle guard but with a FIXED key — the sign-in
// toast is global (not per-equipment). D6: an 8s sessionStorage time-window that RE-ARMS, so a
// later logged-out scan (sign in → sign out → re-tap on a long-lived native process) re-explains
// instead of silently redirecting forever.
const NFC_SIGNIN_TOAST_GUARD_KEY = "vt_nfc_signin_toast_shown";
const NFC_SIGNIN_TOAST_TTL_MS = 8_000;

export function markNfcSignInToastShown(): void {
  try {
    sessionStorage.setItem(NFC_SIGNIN_TOAST_GUARD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable */
  }
}

export function wasNfcSignInToastShownRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(NFC_SIGNIN_TOAST_GUARD_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < NFC_SIGNIN_TOAST_TTL_MS;
  } catch {
    return false;
  }
}

export async function runEquipmentQuickToggle(
  equipmentId: string,
  equipmentName: string,
  queryClient: QueryClient,
): Promise<void> {
  try {
    const result = await api.equipment.quickToggle(equipmentId);
    await queryClient.invalidateQueries({ queryKey: [`/api/equipment/${equipmentId}`] });
    await queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
    if (result.action === "checkout") {
      haptics.scanSuccess();
      toast.success(t.equipmentNfc.toggleCheckedOut(equipmentName));
    } else if (result.action === "return") {
      haptics.scanSuccess();
      toast.success(t.equipmentNfc.toggleReturned(equipmentName));
    } else {
      haptics.error();
      const email =
        result.checkedOutByEmail ??
        (result.equipment.checkedOutByEmail as string | undefined) ??
        t.common.unknown;
      toast.error(t.equipmentNfc.toggleBlocked(email));
    }
  } catch (err) {
    haptics.error();
    if (isNetworkError(err)) {
      clearNfcToggleFired(equipmentId);
      toast.error(t.equipmentNfc.onlineRequired);
      return;
    }
    if (err instanceof ApiError && err.status === 409) {
      clearNfcToggleFired(equipmentId);
      const email =
        (typeof err.payload.checkedOutByEmail === "string" && err.payload.checkedOutByEmail) ||
        t.common.unknown;
      toast.error(t.equipmentNfc.toggleBlocked(email));
      return;
    }
    clearNfcToggleFired(equipmentId);
    throw err;
  }
}

/** Web NFC exposes record.data as ArrayBuffer or ArrayBufferView (e.g. DataView). */
export function ndefRecordToUint8Array(data: BufferSource | undefined): Uint8Array | null {
  if (!data) return null;
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

export function decodeNdefTextFromRecord(record: {
  recordType?: string;
  data?: BufferSource;
}): string | null {
  if (record.recordType !== "text") return null;
  const view = ndefRecordToUint8Array(record.data);
  if (!view?.length) return null;
  const raw = new TextDecoder().decode(view);
  const tagId = raw.replace(/^\x02[a-z]{2}/i, "").replace(/\0+$/, "").trim();
  return tagId || null;
}

export function decodeNdefTextFromReadingEvent(event: {
  message?: { records?: Array<{ recordType?: string; data?: BufferSource }> };
}): string | null {
  for (const record of event.message?.records ?? []) {
    const text = decodeNdefTextFromRecord(record);
    if (text) return text;
  }
  return null;
}

export function decodeNdefUrlFromReadingEvent(event: {
  message?: { records?: Array<{ recordType?: string; data?: BufferSource }> };
}): string | null {
  const records = event.message?.records;
  if (!records?.length) return null;
  for (const record of records) {
    if (record.recordType !== "url" && record.recordType !== "absolute-url") continue;
    const view = ndefRecordToUint8Array(record.data);
    if (!view?.length) continue;
    const prefixCode = view[0] ?? 0;
    const rest = new TextDecoder().decode(view.subarray(1));
    const prefixes = [
      "",
      "http://www.",
      "https://www.",
      "http://",
      "https://",
    ];
    const prefix = prefixes[prefixCode] ?? "";
    return `${prefix}${rest}`;
  }
  return null;
}
