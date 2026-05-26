import type { PendingSync } from "./offline-db";

/** Bounded pending-queue depth buckets (Dexie aggregate, no per-row labels). */
export type OfflineSyncPendingCountBucket = "0" | "1" | "2_5" | "6_plus";

/** Oldest pending/processing row age SLO proxy. */
export type OfflineSyncOldestPendingAgeBucket =
  | "none"
  | "lt_60s"
  | "lt_5m"
  | "lt_1h"
  | "gte_1h";

export type OfflineSyncDeadLetterBucket = "0" | "1" | "2_plus";
export type OfflineSyncConflictBucket = "0" | "1_plus";

/** Session totals since load — bucketed at report time. */
export type OfflineSyncSessionOutcomeBucket = "0" | "1_5" | "6_plus";

export interface OfflineSyncTelemetryBuckets {
  offlineSyncPendingCountBucket: OfflineSyncPendingCountBucket;
  offlineSyncOldestPendingAgeBucket: OfflineSyncOldestPendingAgeBucket;
  offlineSyncDeadLetterBucket: OfflineSyncDeadLetterBucket;
  offlineSyncConflictBucket: OfflineSyncConflictBucket;
  offlineSyncSessionSuccessBucket: OfflineSyncSessionOutcomeBucket;
  offlineSyncSessionConflictBucket: OfflineSyncSessionOutcomeBucket;
  offlineSyncSessionDeadBucket: OfflineSyncSessionOutcomeBucket;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

function isActiveQueueStatus(status: PendingSync["status"]): boolean {
  return status === "pending" || status === "processing";
}

function isDeadLetterStatus(status: PendingSync["status"]): boolean {
  return status === "dead" || status === "failed";
}

export function bucketPendingCount(count: number): OfflineSyncPendingCountBucket {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 5) return "2_5";
  return "6_plus";
}

export function bucketOldestPendingAgeMs(ageMs: number | null): OfflineSyncOldestPendingAgeBucket {
  if (ageMs === null || !Number.isFinite(ageMs) || ageMs < 0) return "none";
  if (ageMs < 60_000) return "lt_60s";
  if (ageMs < 5 * MS_PER_MINUTE) return "lt_5m";
  if (ageMs < MS_PER_HOUR) return "lt_1h";
  return "gte_1h";
}

export function bucketDeadLetterCount(count: number): OfflineSyncDeadLetterBucket {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  return "2_plus";
}

export function bucketConflictCount(count: number): OfflineSyncConflictBucket {
  return count <= 0 ? "0" : "1_plus";
}

export function bucketSessionOutcomeCount(count: number): OfflineSyncSessionOutcomeBucket {
  if (count <= 0) return "0";
  if (count <= 5) return "1_5";
  return "6_plus";
}

/**
 * Maps Dexie queue rows to bounded telemetry buckets (Phase 8 / OFF-08).
 * Session outcome buckets use in-memory counters passed in from sync-engine.
 */
export function computeOfflineSyncTelemetryBuckets(
  rows: readonly PendingSync[],
  session: {
    syncSuccessReports: number;
    syncConflictReports: number;
    syncDeadReports: number;
  },
  now: Date = new Date(),
): OfflineSyncTelemetryBuckets {
  const nowMs = now.getTime();
  let pendingCount = 0;
  let oldestCreatedMs: number | null = null;

  let deadLetterCount = 0;
  let conflictCount = 0;

  for (const row of rows) {
    if (isActiveQueueStatus(row.status)) {
      pendingCount++;
      const created = row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
      if (Number.isFinite(created)) {
        if (oldestCreatedMs === null || created < oldestCreatedMs) {
          oldestCreatedMs = created;
        }
      }
    }
    if (isDeadLetterStatus(row.status)) {
      deadLetterCount++;
    }
    if (row.status === "conflict") {
      conflictCount++;
    }
  }

  const oldestAgeMs =
    oldestCreatedMs === null ? null : Math.max(0, nowMs - oldestCreatedMs);

  return {
    offlineSyncPendingCountBucket: bucketPendingCount(pendingCount),
    offlineSyncOldestPendingAgeBucket: bucketOldestPendingAgeMs(oldestAgeMs),
    offlineSyncDeadLetterBucket: bucketDeadLetterCount(deadLetterCount),
    offlineSyncConflictBucket: bucketConflictCount(conflictCount),
    offlineSyncSessionSuccessBucket: bucketSessionOutcomeCount(session.syncSuccessReports),
    offlineSyncSessionConflictBucket: bucketSessionOutcomeCount(session.syncConflictReports),
    offlineSyncSessionDeadBucket: bucketSessionOutcomeCount(session.syncDeadReports),
  };
}
