import type { ISyncQueue, ISyncQueueEntry } from "@/core/ports";
import { getPendingSync, getPendingCount, getFailedCount } from "@/lib/offline-db";

class SyncQueueAdapter implements ISyncQueue {
  async getPending(): Promise<ISyncQueueEntry[]> {
    return getPendingSync();
  }

  async pendingCount(): Promise<number> {
    return getPendingCount();
  }

  async failedCount(): Promise<number> {
    return getFailedCount();
  }
}

export const syncQueue: ISyncQueue = new SyncQueueAdapter();
