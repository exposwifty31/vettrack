/**
 * Pure idle detector for the offline sync queue (Phase 9 checkpoint gate).
 * Used before optional post-sync reconciliation; no Dexie or network I/O.
 */

export type SyncQueueIdleSnapshot = {
  /** `sync-engine` is actively processing a burst. */
  isSyncing: boolean;
  /** Rows with status `pending` awaiting replay (see `getPendingSync`). */
  pendingReplayCount: number;
  /** A follow-up `processQueue` burst is scheduled (BURST_DELAY_MS). */
  hasScheduledBurst: boolean;
  /** Circuit breaker paused replay; pending rows may still exist. */
  isCircuitOpen: boolean;
  /** Operator or auth path halted the queue. */
  haltQueue: boolean;
};

export type SyncQueueIdleReason =
  | "idle"
  | "syncing"
  | "pending_replay"
  | "burst_scheduled"
  | "circuit_open"
  | "halted";

export type SyncQueueIdleEvaluation = {
  isIdle: boolean;
  reason: SyncQueueIdleReason;
};

/**
 * Returns whether the sync engine has reached a safe checkpoint to run
 * post-sync reconciliation (authoritative refetch / cache repair).
 */
export function evaluateSyncQueueIdle(snapshot: SyncQueueIdleSnapshot): SyncQueueIdleEvaluation {
  if (snapshot.haltQueue) {
    return { isIdle: false, reason: "halted" };
  }
  if (snapshot.isSyncing) {
    return { isIdle: false, reason: "syncing" };
  }
  if (snapshot.pendingReplayCount > 0) {
    return { isIdle: false, reason: "pending_replay" };
  }
  if (snapshot.hasScheduledBurst) {
    return { isIdle: false, reason: "burst_scheduled" };
  }
  if (snapshot.isCircuitOpen) {
    return { isIdle: false, reason: "circuit_open" };
  }
  return { isIdle: true, reason: "idle" };
}
