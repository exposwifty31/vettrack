import Dexie, { type Table } from "dexie";
import type { QueryClient } from "@tanstack/react-query";
import type { Equipment, ScanLog, Folder, Room } from "@/types";
import { assertPendingSyncEnqueueAllowed } from "@/lib/offline-policy";

export type PendingSyncStatus = "pending" | "synced" | "failed";
export type PendingSyncType =
  | "scan"
  | "seen"
  | "create"
  | "update"
  | "delete"
  | "checkout"
  | "return"
  | "return_with_charge";

export interface PendingSync {
  id?: number;
  type: PendingSyncType;
  endpoint: string;
  method: string;
  body: string;
  createdAt: Date;
  retries: number;
  status: PendingSyncStatus;
  clientTimestamp: number;
  optimisticData?: string;
  errorMessage?: string;
  equipmentName?: string;
}

class VetTrackDB extends Dexie {
  equipment!: Table<Equipment>;
  scanLogs!: Table<ScanLog>;
  folders!: Table<Folder>;
  rooms!: Table<Room>;
  pendingSync!: Table<PendingSync>;

  constructor() {
    super("vettrack");
    this.version(3).stores({
      equipment: "id, name, status, folderId, lastSeen, createdAt",
      scanLogs: "id, equipmentId, timestamp",
      folders: "id, name, type",
      pendingSync: "++id, type, createdAt, status, clientTimestamp",
    });
    this.version(4).stores({
      equipment: "id, name, status, folderId, roomId, location, lastSeen, createdAt",
      scanLogs: "id, equipmentId, timestamp",
      folders: "id, name, type",
      rooms: "id, name, syncStatus",
      pendingSync: "++id, type, createdAt, status, clientTimestamp",
    });
  }
}

export const offlineDb = new VetTrackDB();

function getPendingSyncTable(): Table<PendingSync, number> | null {
  // Resolve the table from Dexie's runtime registry instead of relying on
  // class field typing. This prevents undefined table access in edge startup
  // or migration states.
  const table = offlineDb.tables.find((t) => t.name === "pendingSync");
  return (table as Table<PendingSync, number> | undefined) ?? null;
}

export async function cacheEquipment(items: Equipment[]) {
  await offlineDb.equipment.bulkPut(items);
}

export async function getCachedEquipment(): Promise<Equipment[]> {
  return offlineDb.equipment.toArray();
}

export async function getCachedEquipmentById(id: string): Promise<Equipment | undefined> {
  return offlineDb.equipment.get(id);
}

export async function updateCachedEquipment(id: string, updates: Partial<Equipment>) {
  await offlineDb.equipment.update(id, updates);
}

export async function cacheScanLogs(equipmentId: string, logs: ScanLog[]) {
  await offlineDb.scanLogs.bulkPut(logs);
}

export async function getCachedScanLogs(equipmentId: string): Promise<ScanLog[]> {
  return offlineDb.scanLogs
    .where("equipmentId")
    .equals(equipmentId)
    .reverse()
    .sortBy("timestamp");
}

export async function cacheFolders(items: Folder[]) {
  await offlineDb.folders.bulkPut(items);
}

export async function getCachedFolders(): Promise<Folder[]> {
  return offlineDb.folders.toArray();
}

export async function cacheRooms(items: Room[]) {
  await offlineDb.rooms.bulkPut(items);
}

export async function getCachedRooms(): Promise<Room[]> {
  return offlineDb.rooms.toArray();
}

export async function getCachedRoomById(id: string): Promise<Room | undefined> {
  return offlineDb.rooms.get(id);
}

// checkout and return are idempotent per endpoint: a second offline tap on the
// same item should overwrite the queued entry rather than replay it twice.
// "scan" is intentionally excluded: each scan is a distinct audit event
// (different status/note) and must be replayed individually to preserve the
// full scanLogs history — collapsing them would silently drop intermediate entries.
const DEDUP_SYNC_TYPES: ReadonlySet<PendingSyncType> = new Set([
  "checkout",
  "return",
  "return_with_charge",
]);

export async function addPendingSync(op: Omit<PendingSync, "id">): Promise<number | undefined> {
  assertPendingSyncEnqueueAllowed({
    type: op.type,
    endpoint: op.endpoint,
    method: op.method,
  });

  const table = getPendingSyncTable();
  if (!table) return undefined;

  if (DEDUP_SYNC_TYPES.has(op.type)) {
    try {
      const result = await offlineDb.transaction("rw", table, async () => {
        const existing = await table
          .where("status")
          .equals("pending")
          .and(
            (item) =>
              item.endpoint === op.endpoint &&
              item.method === op.method &&
              item.type === op.type,
          )
          .first();

        if (existing?.id !== undefined) {
          await table.update(existing.id, {
            clientTimestamp: op.clientTimestamp,
            createdAt: op.createdAt,
            body: op.body,
            optimisticData: op.optimisticData,
            equipmentName: op.equipmentName,
            retries: 0,
          });
          return existing.id;
        }

        return (await table.add(op)) as number;
      });
      return result;
    } catch {
      // Fall through to non-transactional insert if tx fails
    }
  }

  return table.add(op) as Promise<number>;
}

export async function getPendingSync(): Promise<PendingSync[]> {
  return offlineDb.pendingSync
    .where("status")
    .equals("pending")
    .sortBy("clientTimestamp");
}

export async function getAllPendingSync(): Promise<PendingSync[]> {
  return offlineDb.pendingSync.orderBy("createdAt").toArray();
}

export async function updatePendingSync(id: number, updates: Partial<PendingSync>) {
  return offlineDb.pendingSync.update(id, updates);
}

export async function removePendingSync(id: number) {
  return offlineDb.pendingSync.delete(id);
}

export async function getPendingCount(): Promise<number> {
  return offlineDb.pendingSync.where("status").equals("pending").count();
}

export async function getFailedCount(): Promise<number> {
  return offlineDb.pendingSync.where("status").equals("failed").count();
}

export async function runStartupCleanup(queryClient?: QueryClient): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failedOld = await offlineDb.pendingSync
      .where("status")
      .equals("failed")
      .and((item) => item.createdAt < sevenDaysAgo)
      .primaryKeys();
    if (failedOld.length > 0) {
      await offlineDb.pendingSync.bulkDelete(failedOld as number[]);
    }

    const syncedIds = await offlineDb.pendingSync
      .where("status")
      .equals("synced")
      .primaryKeys();
    if (syncedIds.length > 0) {
      await offlineDb.pendingSync.bulkDelete(syncedIds as number[]);
    }

    const allEquipmentIds = await offlineDb.equipment
      .toCollection()
      .primaryKeys() as string[];
    const equipmentIdSet = new Set(allEquipmentIds);

    const allLogs = await offlineDb.scanLogs.toArray();
    const toDeleteLogs: string[] = [];

    const byEquipment = new Map<string, typeof allLogs>();
    for (const log of allLogs) {
      if (!equipmentIdSet.has(log.equipmentId)) {
        toDeleteLogs.push(log.id);
        continue;
      }
      const group = byEquipment.get(log.equipmentId) ?? [];
      group.push(log);
      byEquipment.set(log.equipmentId, group);
    }

    for (const [, logs] of byEquipment) {
      if (logs.length > 200) {
        logs.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
        const excess = logs.slice(0, logs.length - 200);
        for (const l of excess) toDeleteLogs.push(l.id);
      }
    }

    if (toDeleteLogs.length > 0) {
      await offlineDb.scanLogs.bulkDelete(toDeleteLogs);
    }

    if (queryClient) {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment/my"] });
    }
  } catch {
  }
}
