import type { IEquipmentCache, IEquipmentCacheEntry } from "@/core/ports";
import {
  getCachedEquipment,
  getCachedEquipmentById,
  cacheEquipment,
} from "@/lib/offline-db";
import type { Equipment } from "@/types";

function toEntry(e: Equipment): IEquipmentCacheEntry {
  return {
    id: e.id,
    name: e.name,
    status: e.status,
    roomId: e.roomId ?? null,
    location: e.location ?? null,
    lastSeen: e.lastSeen ?? null,
  };
}

class EquipmentCacheAdapter implements IEquipmentCache {
  async getAll(): Promise<IEquipmentCacheEntry[]> {
    const rows = await getCachedEquipment();
    return rows.map(toEntry);
  }

  async getById(id: string): Promise<IEquipmentCacheEntry | null> {
    const row = await getCachedEquipmentById(id);
    return row ? toEntry(row) : null;
  }

  async upsertMany(items: IEquipmentCacheEntry[]): Promise<void> {
    // Callers always pass full Equipment objects narrowed to the cache interface;
    // the Dexie layer stores whatever shape it receives.
    await cacheEquipment(items as unknown as Equipment[]);
  }
}

export const equipmentCache: IEquipmentCache = new EquipmentCacheAdapter();
