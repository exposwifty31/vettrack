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
    mockGetCachedEquipment.mockResolvedValueOnce([{ id: "e1", name: "Ventilator" }]);
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

  it("upsertMany delegates to cacheEquipment", async () => {
    const { equipmentCache } = await import("../src/infrastructure/db/EquipmentCacheAdapter");
    await equipmentCache.upsertMany([{ id: "e1", name: "Defibrillator", status: "ok", roomId: null, location: null, lastSeen: null }]);
    expect(mockCacheEquipment).toHaveBeenCalled();
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
});
