import { describe, it, expect } from "vitest";
import type {
  IHapticsProvider,
  INfcProvider,
  IDeepLinkProvider,
  IEquipmentCache,
  ISyncQueue,
} from "../src/core/ports";

/**
 * Structural tests — verify that the adapters implement their port interfaces.
 * These import is type-only; the runtime checks use duck-typing assertions.
 */

function hasMethod(obj: object, name: string): boolean {
  return typeof (obj as Record<string, unknown>)[name] === "function";
}

describe("IHapticsProvider contract", () => {
  it("HapticsAdapter satisfies the interface", async () => {
    const { haptics } = await import("../src/infrastructure/platform/HapticsAdapter");
    const adapter = haptics as IHapticsProvider;
    expect(hasMethod(adapter, "impact")).toBe(true);
    expect(hasMethod(adapter, "selectionChanged")).toBe(true);
    expect(hasMethod(adapter, "notification")).toBe(true);
  });
});

describe("INfcProvider contract", () => {
  it("NfcAdapter satisfies the interface", async () => {
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    const adapter = nfc as INfcProvider;
    expect(hasMethod(adapter, "isSupported")).toBe(true);
    expect(hasMethod(adapter, "readOnce")).toBe(true);
    expect(hasMethod(adapter, "startSession")).toBe(true);
  });
});

describe("IDeepLinkProvider contract", () => {
  it("DeepLinkAdapter satisfies the interface", async () => {
    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const adapter = deepLink as IDeepLinkProvider;
    expect(hasMethod(adapter, "onOpen")).toBe(true);
  });
});

describe("IEquipmentCache contract", () => {
  it("EquipmentCacheAdapter satisfies the interface", async () => {
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    const adapter = equipmentCache as IEquipmentCache;
    expect(hasMethod(adapter, "getAll")).toBe(true);
    expect(hasMethod(adapter, "getById")).toBe(true);
    expect(hasMethod(adapter, "upsertMany")).toBe(true);
  });
});

describe("ISyncQueue contract", () => {
  it("SyncQueueAdapter satisfies the interface", async () => {
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    const adapter = syncQueue as ISyncQueue;
    expect(hasMethod(adapter, "getPending")).toBe(true);
    expect(hasMethod(adapter, "pendingCount")).toBe(true);
    expect(hasMethod(adapter, "failedCount")).toBe(true);
  });
});
