import type { INfcProvider, NfcReadPayload, NfcScanSession } from "@/core/ports";
import {
  isNfcSupported,
  readNfcOnce,
  startNfcScanSession,
} from "@/lib/nfc-platform";

/**
 * NFC adapter — delegates to the existing nfc-platform abstraction in src/lib/.
 * Exposes the INfcProvider port so features depend on the interface, not the lib.
 */
class NfcAdapter implements INfcProvider {
  async isSupported(): Promise<boolean> {
    return isNfcSupported();
  }

  async readOnce(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<NfcReadPayload> {
    return readNfcOnce({ timeoutMs: options?.timeoutMs, signal: options?.signal });
  }

  async startSession(options: {
    onRead: (payload: NfcReadPayload) => void | Promise<void>;
    signal?: AbortSignal;
  }): Promise<NfcScanSession> {
    return startNfcScanSession({ onRead: options.onRead, signal: options.signal });
  }
}

export const nfc: INfcProvider = new NfcAdapter();
