// Physical equipment sticker payload — the single place that decides what bytes
// go onto an NTAG215. Spec: docs/design/nfc-sticker-e2e-audit.md §"NDEF payload spec".
//
// Pure by design (no Capacitor, no DOM): the audit test asserts the exact bytes.

import { UNIVERSAL_LINK_ORIGIN } from "@/lib/equipment-id";
import {
  encodeCapgoNdefAarRecord,
  encodeCapgoNdefUrlRecord,
  type CapgoNdefRecord,
} from "@/lib/nfc-capgo-decode";
import { ANDROID_APP_PACKAGE } from "../../shared/constants";

/**
 * The URL encoded on the sticker. Always the PRODUCTION universal-link origin —
 * a sticker is a physical artifact, so even a dev build must encode the prod
 * domain (same rule the QR writer follows, see generateQrUrl).
 */
export function buildEquipmentStickerUrl(equipmentId: string): string {
  return `${UNIVERSAL_LINK_ORIGIN}/equipment/${equipmentId}?nfcAction=toggle`;
}

/**
 * Record 1 = well-known URI (what iOS background reading parses),
 * record 2 = AAR (what guarantees the Android app/Play jump).
 */
export function buildEquipmentStickerRecords(equipmentId: string): CapgoNdefRecord[] {
  return [
    encodeCapgoNdefUrlRecord(buildEquipmentStickerUrl(equipmentId)),
    encodeCapgoNdefAarRecord(ANDROID_APP_PACKAGE),
  ];
}
