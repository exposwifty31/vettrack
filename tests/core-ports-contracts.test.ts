import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  INfcProvider,
  IDeepLinkProvider,
  IEquipmentCache,
  ISyncQueue,
} from "../src/core/ports";

function hasMethod(obj: object, name: string): boolean {
  return typeof (obj as Record<string, unknown>)[name] === "function";
}

describe("INfcProvider contract", () => {
  beforeEach(() => vi.resetModules());

  it("NfcAdapter satisfies the interface", async () => {
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    const adapter = nfc as INfcProvider;
    expect(hasMethod(adapter, "isSupported")).toBe(true);
    expect(hasMethod(adapter, "readOnce")).toBe(true);
    expect(hasMethod(adapter, "startSession")).toBe(true);
  });

  it("surfaces readOnce rejection unchanged", async () => {
    vi.doMock("../src/lib/nfc-platform", () => ({
      isNfcSupported: vi.fn().mockResolvedValue(true),
      readNfcOnce: vi.fn().mockRejectedValue(new Error("NFC timeout")),
      startNfcScanSession: vi.fn(),
    }));
    const { nfc } = await import("../src/infrastructure/platform/NfcAdapter");
    await expect(nfc.readOnce()).rejects.toThrow("NFC timeout");
  });
});

describe("IDeepLinkProvider contract", () => {
  beforeEach(() => vi.resetModules());

  it("DeepLinkAdapter satisfies the interface", async () => {
    vi.doMock("../src/lib/capacitor-runtime", () => ({
      isCapacitorNative: vi.fn(() => false),
    }));
    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const adapter = deepLink as IDeepLinkProvider;
    expect(hasMethod(adapter, "onOpen")).toBe(true);
  });

  it("cleanup is a function in browser context", async () => {
    vi.doMock("../src/lib/capacitor-runtime", () => ({
      isCapacitorNative: vi.fn(() => false),
    }));
    const { deepLink } = await import("../src/infrastructure/platform/DeepLinkAdapter");
    const cleanup = deepLink.onOpen(vi.fn());
    expect(typeof cleanup).toBe("function");
  });
});

describe("IEquipmentCache contract", () => {
  beforeEach(() => vi.resetModules());

  it("EquipmentCacheAdapter satisfies the interface", async () => {
    vi.doMock("../src/lib/offline-db", () => ({
      getCachedEquipment: vi.fn().mockResolvedValue([]),
      getCachedEquipmentById: vi.fn().mockResolvedValue(undefined),
      cacheEquipment: vi.fn().mockResolvedValue(undefined),
    }));
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    const adapter = equipmentCache as IEquipmentCache;
    expect(hasMethod(adapter, "getAll")).toBe(true);
    expect(hasMethod(adapter, "getById")).toBe(true);
    expect(hasMethod(adapter, "upsertMany")).toBe(true);
  });

  it("getAll rejects when the underlying store throws", async () => {
    vi.doMock("../src/lib/offline-db", () => ({
      getCachedEquipment: vi.fn().mockRejectedValue(new Error("IndexedDB unavailable")),
      getCachedEquipmentById: vi.fn(),
      cacheEquipment: vi.fn(),
    }));
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    await expect(equipmentCache.getAll()).rejects.toThrow("IndexedDB unavailable");
  });
});

describe("ISyncQueue contract", () => {
  beforeEach(() => vi.resetModules());

  it("SyncQueueAdapter satisfies the interface", async () => {
    vi.doMock("../src/lib/offline-db", () => ({
      getPendingSync: vi.fn().mockResolvedValue([]),
      getPendingCount: vi.fn().mockResolvedValue(0),
      getFailedCount: vi.fn().mockResolvedValue(0),
    }));
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    const adapter = syncQueue as ISyncQueue;
    expect(hasMethod(adapter, "getPending")).toBe(true);
    expect(hasMethod(adapter, "pendingCount")).toBe(true);
    expect(hasMethod(adapter, "failedCount")).toBe(true);
  });

  it("getPending rejects when the underlying store throws", async () => {
    vi.doMock("../src/lib/offline-db", () => ({
      getPendingSync: vi.fn().mockRejectedValue(new Error("IndexedDB unavailable")),
      getPendingCount: vi.fn(),
      getFailedCount: vi.fn(),
    }));
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    await expect(syncQueue.getPending()).rejects.toThrow("IndexedDB unavailable");
  });
});
