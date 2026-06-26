import type { ISyncQueue, ISyncQueueEntry } from "@/core/ports";
import { getPendingSync, getPendingCount, getFailedCount } from "@/lib/offline-db";

class SyncQueueAdapter implements ISyncQueue {
  async getPending(): Promise<ISyncQueueEntry[]> {
    const rows = await getPendingSync();
    return rows as unknown as ISyncQueueEntry[];
  }

  async pendingCount(): Promise<number> {
    return getPendingCount();
  }

  async failedCount(): Promise<number> {
    return getFailedCount();
  }
}

export const syncQueue: ISyncQueue = new SyncQueueAdapter();
