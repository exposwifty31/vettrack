import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCachedEquipment = vi.fn().mockResolvedValue([]);
const mockGetCachedEquipmentById = vi.fn().mockResolvedValue(undefined);
const mockCacheEquipment = vi.fn().mockResolvedValue(undefined);
const mockGetPendingSync = vi.fn().mockResolvedValue([]);
const mockGetPendingCount = vi.fn().mockResolvedValue(0);
const mockGetFailedCount = vi.fn().mockResolvedValue(0);

vi.mock("../src/lib/offline-db", () => ({
  getCachedEquipment: mockGetCachedEquipment,
  getCachedEquipmentById: mockGetCachedEquipmentById,
  cacheEquipment: mockCacheEquipment,
  getPendingSync: mockGetPendingSync,
  getPendingCount: mockGetPendingCount,
  getFailedCount: mockGetFailedCount,
}));

describe("EquipmentCacheAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getAll delegates to getCachedEquipment", async () => {
    mockGetCachedEquipment.mockResolvedValueOnce([
      { id: "e1", name: "Ventilator", status: "ok", roomId: null, location: null, lastSeen: null, createdAt: "2024-01-01" },
    ]);
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    const items = await equipmentCache.getAll();
    expect(mockGetCachedEquipment).toHaveBeenCalled();
    expect(items[0].id).toBe("e1");
  });

  it("getById returns null when not found", async () => {
    mockGetCachedEquipmentById.mockResolvedValueOnce(undefined);
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    const item = await equipmentCache.getById("missing");
    expect(item).toBeNull();
  });

  it("getById maps entry fields when found", async () => {
    mockGetCachedEquipmentById.mockResolvedValueOnce({
      id: "e2", name: "Defibrillator", status: "ok", roomId: "r1", location: "Bay 2", lastSeen: "2024-01-02", createdAt: "2024-01-01",
    });
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    const item = await equipmentCache.getById("e2");
    expect(item).not.toBeNull();
    expect(item!.id).toBe("e2");
    expect(item!.roomId).toBe("r1");
  });

  it("upsertMany delegates to cacheEquipment", async () => {
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    await equipmentCache.upsertMany([{ id: "e1", name: "Defibrillator", status: "ok", roomId: null, location: null, lastSeen: null }]);
    expect(mockCacheEquipment).toHaveBeenCalled();
  });

  it("getAll rejects when getCachedEquipment throws", async () => {
    mockGetCachedEquipment.mockRejectedValueOnce(new Error("IndexedDB error"));
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    await expect(equipmentCache.getAll()).rejects.toThrow("IndexedDB error");
  });

  it("getById rejects when getCachedEquipmentById throws", async () => {
    mockGetCachedEquipmentById.mockRejectedValueOnce(new Error("IndexedDB error"));
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    await expect(equipmentCache.getById("x")).rejects.toThrow("IndexedDB error");
  });
});

describe("SyncQueueAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("getPending delegates to getPendingSync", async () => {
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    await syncQueue.getPending();
    expect(mockGetPendingSync).toHaveBeenCalled();
  });

  it("pendingCount delegates to getPendingCount", async () => {
    mockGetPendingCount.mockResolvedValueOnce(3);
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    const count = await syncQueue.pendingCount();
    expect(count).toBe(3);
  });

  it("failedCount delegates to getFailedCount", async () => {
    mockGetFailedCount.mockResolvedValueOnce(1);
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    const count = await syncQueue.failedCount();
    expect(count).toBe(1);
  });

  it("getPending rejects when getPendingSync throws", async () => {
    mockGetPendingSync.mockRejectedValueOnce(new Error("IndexedDB error"));
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    await expect(syncQueue.getPending()).rejects.toThrow("IndexedDB error");
  });

  it("pendingCount rejects when getPendingCount throws", async () => {
    mockGetPendingCount.mockRejectedValueOnce(new Error("IndexedDB error"));
    const { syncQueue } = await import("../src/infrastructure/db/SyncQueueAdapter");
    await expect(syncQueue.pendingCount()).rejects.toThrow("IndexedDB error");
  });
});
