// Permanent sticker lock — one call site, two native implementations.
//
// Android: `@capgo/capacitor-nfc` `makeReadOnly()` (Ndef.makeReadOnly).
// iOS:     the plugin hard-rejects with UNSUPPORTED, so the local Swift bridge
//          `ios/App/App/NfcLockPlugin.swift` runs CoreNFC's NFCNDEFTag.writeLock.
//
// Irreversible by design: an NTAG215 lock cannot be undone, so callers must
// confirm with the operator first. Locking is an identification concern only —
// it grants the tag no custody authority (ADR-006 posture).

import { registerPlugin } from "@capacitor/core";
import { CapacitorNfc } from "@capgo/capacitor-nfc";
import { capacitorPlatform, isCapacitorNative } from "@/lib/capacitor-runtime";

interface NfcLockPlugin {
  lockTag(options?: { alertMessage?: string }): Promise<{ locked: boolean; alreadyLocked: boolean }>;
}

const NfcLock = registerPlugin<NfcLockPlugin>("NfcLock");

export type NfcLockResult = { alreadyLocked: boolean };

/**
 * Permanently lock the sticker the operator is about to present. Rejects when
 * the platform cannot lock or the tag refuses — never resolves on a failed lock,
 * because a sticker reported as locked but still writable is the field risk the
 * lock exists to remove.
 */
export async function lockNfcTag(alertMessage?: string): Promise<NfcLockResult> {
  if (!isCapacitorNative()) throw new Error("nfc_lock_unsupported");

  if (capacitorPlatform() === "ios") {
    const result = await NfcLock.lockTag(alertMessage ? { alertMessage } : {});
    return { alreadyLocked: result.alreadyLocked };
  }

  // Android: makeReadOnly() acts on the tag the plugin LAST DISCOVERED, so the
  // scan session has to run first — calling it cold rejects with "No NFC tag
  // available". iOS needs no equivalent because the Swift bridge owns its own
  // session end to end.
  await CapacitorNfc.startScanning({ invalidateAfterFirstRead: false, alertMessage });
  return new Promise((resolve, reject) => {
    let listenerHandle: { remove: () => Promise<void> } | null = null;
    void (async () => {
      try {
        listenerHandle = await CapacitorNfc.addListener("nfcEvent", async () => {
          try {
            await CapacitorNfc.makeReadOnly();
            resolve({ alreadyLocked: false });
          } catch (err) {
            reject(err);
          } finally {
            await listenerHandle?.remove();
            await CapacitorNfc.stopScanning();
          }
        });
      } catch (err) {
        reject(err);
      }
    })();
  });
}
