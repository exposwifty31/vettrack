import type { IEquipmentCache, IEquipmentCacheEntry } from "@/core/ports";
import {
  getCachedEquipment,
  getCachedEquipmentById,
  cacheEquipment,
} from "@/lib/offline-db";
import type { Equipment } from "@/types";

class EquipmentCacheAdapter implements IEquipmentCache {
  async getAll(): Promise<IEquipmentCacheEntry[]> {
    const rows = await getCachedEquipment();
    return rows as unknown as IEquipmentCacheEntry[];
  }

  async getById(id: string): Promise<IEquipmentCacheEntry | null> {
    const row = await getCachedEquipmentById(id);
    return (row as unknown as IEquipmentCacheEntry | undefined) ?? null;
  }

  async upsertMany(items: IEquipmentCacheEntry[]): Promise<void> {
    await cacheEquipment(items as unknown as Equipment[]);
  }
}

export const equipmentCache: IEquipmentCache = new EquipmentCacheAdapter();
