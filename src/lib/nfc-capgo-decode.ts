import {
  decodeNdefTextFromRecord,
  decodeNdefUrlFromReadingEvent,
  ndefRecordToUint8Array,
} from "@/lib/nfc-equipment-toggle";

/** Capgo plugin NDEF record shape (byte arrays). */
export interface CapgoNdefRecord {
  tnf?: number;
  type?: number[];
  id?: number[];
  payload?: number[];
}

export interface NfcReadPayload {
  text: string | null;
  url: string | null;
  /** Raw tag UID as hex (native Capacitor reads). */
  tagId: string | null;
}

export function tagIdHexFromCapgoId(id: number[] | undefined | null): string | null {
  if (!id?.length) return null;
  return id.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function capgoRecordToWebShape(record: CapgoNdefRecord): {
  recordType?: string;
  data?: BufferSource;
} {
  const typeBytes = record.type ?? [];
  const typeStr = typeBytes.length
    ? String.fromCharCode(...typeBytes)
    : "";
  let recordType: string | undefined;
  if (record.tnf === 0x01 && typeStr === "T") recordType = "text";
  if (record.tnf === 0x01 && typeStr === "U") recordType = "url";
  const payload = record.payload;
  const data =
    payload && payload.length
      ? new Uint8Array(payload).buffer
      : undefined;
  return { recordType, data };
}

/** Decode Capgo tag records into text tag id and/or URL (same semantics as Web NFC). */
export function decodeCapgoNdefRecords(
  records: CapgoNdefRecord[] | null | undefined,
  tagId: string | null = null,
): NfcReadPayload {
  let text: string | null = null;
  let url: string | null = null;

  for (const raw of records ?? []) {
    const shaped = capgoRecordToWebShape(raw);
    if (!text && shaped.recordType === "text") {
      text = decodeNdefTextFromRecord(shaped);
    }
    if (!url && shaped.recordType === "url") {
      const view = ndefRecordToUint8Array(shaped.data);
      if (view?.length) {
        const prefixCode = view[0] ?? 0;
        const rest = new TextDecoder().decode(view.subarray(1));
        const prefixes = ["", "http://www.", "https://www.", "http://", "https://"];
        const prefix = prefixes[prefixCode] ?? "";
        url = `${prefix}${rest}`;
      }
    }
  }

  if (!url && records?.length) {
    url = decodeNdefUrlFromReadingEvent({
      message: {
        records: (records ?? []).map((r) => {
          const shaped = capgoRecordToWebShape(r);
          return {
            recordType: shaped.recordType,
            data: shaped.data,
          };
        }),
      },
    });
  }

  return { text, url, tagId };
}

/** Build a Well-known URI (type `U`) record for Capgo write(). */
export function encodeCapgoNdefUrlRecord(url: string): CapgoNdefRecord {
  const prefixes = ["", "http://www.", "https://www.", "http://", "https://"];
  let prefixCode = 0;
  let rest = url;
  for (let i = prefixes.length - 1; i >= 0; i--) {
    const p = prefixes[i];
    if (p && url.startsWith(p)) {
      prefixCode = i;
      rest = url.slice(p.length);
      break;
    }
  }
  const restBytes = Array.from(new TextEncoder().encode(rest));
  return {
    tnf: 0x01,
    type: [0x55],
    id: [],
    payload: [prefixCode, ...restBytes],
  };
}
