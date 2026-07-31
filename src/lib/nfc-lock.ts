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

// Longer than the general read timeout (nfc-platform.ts uses 15s) — locking is a
// deliberate second tap after an explicit confirm dialog, so the operator gets
// more time to present the sticker before the attempt is abandoned.
const ANDROID_LOCK_TIMEOUT_MS = 30_000;

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
    let settled = false;
    let listenerHandle: { remove: () => Promise<void> } | null = null;

    // `@capgo/capacitor-nfc` exposes no Android scan timeout, cancel, or error
    // event — without a bounded wait here, a scan with no tag presented leaves
    // this Promise pending forever and Android reader mode enabled.
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      void (async () => {
        try {
          await listenerHandle?.remove();
          await CapacitorNfc.stopScanning();
        } catch {
          /* ignore — best-effort cleanup */
        }
        fn();
      })();
    };

    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("nfc_lock_timeout")));
    }, ANDROID_LOCK_TIMEOUT_MS);

    void (async () => {
      try {
        listenerHandle = await CapacitorNfc.addListener("nfcEvent", async () => {
          try {
            await CapacitorNfc.makeReadOnly();
            finish(() => resolve({ alreadyLocked: false }));
          } catch (err) {
            finish(() => reject(err));
          }
        });
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    })();
  });
}
