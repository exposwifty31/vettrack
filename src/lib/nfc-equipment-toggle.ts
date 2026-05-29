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
      toast.error(t.equipmentNfc.onlineRequired);
      return;
    }
    if (err instanceof ApiError && err.status === 409) {
      const email =
        (typeof err.payload.checkedOutByEmail === "string" && err.payload.checkedOutByEmail) ||
        t.common.unknown;
      toast.error(t.equipmentNfc.toggleBlocked(email));
      return;
    }
    throw err;
  }
}

export function decodeNdefUrlFromReadingEvent(event: {
  message?: { records?: Array<{ recordType?: string; data?: BufferSource }> };
}): string | null {
  const records = event.message?.records;
  if (!records?.length) return null;
  for (const record of records) {
    if (record.recordType !== "url" && record.recordType !== "absolute-url") continue;
    const data = record.data;
    if (!data) continue;
    const view =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (view.length === 0) continue;
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
