import { isCapacitorNative } from "@/lib/capacitor-runtime";
import {
  decodeCapgoNdefRecords,
  encodeCapgoNdefUrlRecord,
  tagIdHexFromCapgoId,
  type NfcReadPayload,
} from "@/lib/nfc-capgo-decode";
import {
  decodeNdefTextFromReadingEvent,
  decodeNdefUrlFromReadingEvent,
} from "@/lib/nfc-equipment-toggle";
import { t } from "@/lib/i18n";

export type { NfcReadPayload };

let nativeSupportCache: boolean | null = null;

function hasWebNfc(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

async function loadCapgoNfc() {
  const mod = await import("@capgo/capacitor-nfc");
  return mod.CapacitorNfc;
}

/** NFC available: Web NFC (Android Chrome) or native Capacitor plugin (iOS/Android app). */
export async function isNfcSupported(): Promise<boolean> {
  if (hasWebNfc()) return true;
  if (!isCapacitorNative()) return false;
  if (nativeSupportCache !== null) return nativeSupportCache;
  try {
    const CapacitorNfc = await loadCapgoNfc();
    const { supported } = await CapacitorNfc.isSupported();
    nativeSupportCache = supported;
    return supported;
  } catch {
    nativeSupportCache = false;
    return false;
  }
}

/** Sync check for UI that cannot await (prefer isNfcSupported in flows). */
export function isNfcSupportedSync(): boolean {
  if (hasWebNfc()) return true;
  if (isCapacitorNative() && nativeSupportCache === true) return true;
  return false;
}

/** Prime native support flag (call once on app mount in Capacitor). */
export async function primeNfcSupportCache(): Promise<void> {
  if (!isCapacitorNative()) return;
  await isNfcSupported();
}

function mergeReadPayload(parts: NfcReadPayload[]): NfcReadPayload {
  let text: string | null = null;
  let url: string | null = null;
  let tagId: string | null = null;
  for (const p of parts) {
    if (!text && p.text) text = p.text;
    if (!url && p.url) url = p.url;
    if (!tagId && p.tagId) tagId = p.tagId;
  }
  return { text, url, tagId };
}

function payloadFromWebEvent(event: {
  message?: { records?: Array<{ recordType?: string; data?: BufferSource }> };
}): NfcReadPayload {
  const text = decodeNdefTextFromReadingEvent(event);
  const url = decodeNdefUrlFromReadingEvent(event);
  return { text, url, tagId: null };
}

/** First tag read within timeout; rejects on timeout or cancel. */
export function readNfcOnce(options: {
  timeoutMs?: number;
  signal?: AbortSignal;
  alertMessage?: string;
}): Promise<NfcReadPayload> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (hasWebNfc()) return readNfcOnceWeb(timeoutMs, options.signal);
  if (isCapacitorNative()) {
    return readNfcOnceNative(timeoutMs, options.signal, options.alertMessage);
  }
  return Promise.reject(new Error("nfc_unsupported"));
}

async function readNfcOnceWeb(timeoutMs: number, signal?: AbortSignal): Promise<NfcReadPayload> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ndef = new (window as any).NDEFReader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ndef.onreading = (event: any) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve(payloadFromWebEvent(event));
    };
    void ndef.scan().catch((err: unknown) => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

async function readNfcOnceNative(
  timeoutMs: number,
  signal?: AbortSignal,
  alertMessage?: string,
): Promise<NfcReadPayload> {
  const CapacitorNfc = await loadCapgoNfc();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    let settled = false;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      void (async () => {
        try {
          await listenerHandle?.remove();
          await CapacitorNfc.stopScanning();
        } catch {
          /* ignore */
        }
        fn();
      })();
    };

    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("timeout")));
    }, timeoutMs);

    const onAbort = () => {
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    void (async () => {
      try {
        listenerHandle = await CapacitorNfc.addListener("nfcEvent", (event) => {
          const payload = decodeCapgoNdefRecords(
            event.tag?.ndefMessage ?? null,
            tagIdHexFromCapgoId(event.tag?.id),
          );
          finish(() => resolve(payload));
        });
        await CapacitorNfc.startScanning({
          invalidateAfterFirstRead: true,
          alertMessage: alertMessage ?? t.equipmentNfc.scanReady,
        });
      } catch (err) {
        finish(() => reject(err));
      }
    })();
  });
}

export type NfcScanSession = {
  stop: () => Promise<void>;
};

/** Continuous scan; invoke onRead for each tag until stop() or signal abort. */
export async function startNfcScanSession(options: {
  onRead: (payload: NfcReadPayload) => void | Promise<void>;
  signal?: AbortSignal;
  alertMessage?: string;
}): Promise<NfcScanSession> {
  if (hasWebNfc()) return startNfcScanSessionWeb(options);
  if (isCapacitorNative()) return startNfcScanSessionNative(options);
  throw new Error("nfc_unsupported");
}

async function startNfcScanSessionWeb(options: {
  onRead: (payload: NfcReadPayload) => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<NfcScanSession> {
  const controller = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ndef = new (window as any).NDEFReader();
  await ndef.scan({ signal: controller.signal });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ndef.onreading = async (event: any) => {
    await options.onRead(payloadFromWebEvent(event));
  };
  return {
    stop: async () => {
      controller.abort();
    },
  };
}

async function startNfcScanSessionNative(options: {
  onRead: (payload: NfcReadPayload) => void | Promise<void>;
  signal?: AbortSignal;
  alertMessage?: string;
}): Promise<NfcScanSession> {
  const CapacitorNfc = await loadCapgoNfc();
  const listener = await CapacitorNfc.addListener("nfcEvent", async (event) => {
    const payload = decodeCapgoNdefRecords(
      event.tag?.ndefMessage ?? null,
      tagIdHexFromCapgoId(event.tag?.id),
    );
    await options.onRead(payload);
  });

  const onAbort = () => {
    void stop();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  await CapacitorNfc.startScanning({
    invalidateAfterFirstRead: false,
    alertMessage: options.alertMessage ?? t.equipmentNfc.scanReady,
  });

  async function stop() {
    options.signal?.removeEventListener("abort", onAbort);
    await listener.remove();
    await CapacitorNfc.stopScanning();
  }

  return { stop };
}

/** Write URL NDEF record to a tag (tap tag when prompted). */
export async function writeNfcUrl(url: string): Promise<void> {
  if (hasWebNfc()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ndef = new (window as any).NDEFReader();
    await ndef.write({ records: [{ recordType: "url", data: url }] });
    return;
  }
  if (!isCapacitorNative()) throw new Error("nfc_unsupported");

  const CapacitorNfc = await loadCapgoNfc();
  const record = encodeCapgoNdefUrlRecord(url);
  await CapacitorNfc.startScanning({
    invalidateAfterFirstRead: false,
    alertMessage: t.equipmentNfc.writeTag,
  });

  return new Promise((resolve, reject) => {
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void (async () => {
      try {
        listenerHandle = await CapacitorNfc.addListener("nfcEvent", async () => {
          try {
            await CapacitorNfc.write({
              allowFormat: true,
              records: [
                {
                  tnf: record.tnf ?? 0x01,
                  type: record.type ?? [],
                  id: record.id ?? [],
                  payload: record.payload ?? [],
                },
              ],
            });
            await listenerHandle?.remove();
            await CapacitorNfc.stopScanning();
            resolve();
          } catch (err) {
            await listenerHandle?.remove();
            await CapacitorNfc.stopScanning();
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/** Resolve master dock tag id from read payload (text or URL string). */
export function resolveNfcTagId(payload: NfcReadPayload): string | null {
  const merged = mergeReadPayload([payload]);
  if (merged.text?.trim()) return merged.text.trim();
  if (merged.url?.trim()) return merged.url.trim();
  if (merged.tagId?.trim()) return merged.tagId.trim();
  return null;
}
