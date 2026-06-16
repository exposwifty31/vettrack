import { api } from "./api";
import { getCurrentUserId } from "./auth-store";
import { getAllPendingSync } from "./offline-db";
import {
  computeOfflineSyncTelemetryBuckets,
  type OfflineSyncTelemetryBuckets,
} from "./offline-sync-telemetry";
import { getOfflineSyncSessionCounters } from "./offline-sync-session-counters";

export const MIN_REPORT_INTERVAL_MS = 60_000;

let lastReportAtMs = 0;
let lastSnapshotKey: string | null = null;

function snapshotKey(buckets: OfflineSyncTelemetryBuckets): string {
  return [
    buckets.offlineSyncPendingCountBucket,
    buckets.offlineSyncOldestPendingAgeBucket,
    buckets.offlineSyncDeadLetterBucket,
    buckets.offlineSyncConflictBucket,
    buckets.offlineSyncSessionSuccessBucket,
    buckets.offlineSyncSessionConflictBucket,
    buckets.offlineSyncSessionDeadBucket,
  ].join("|");
}

export type OfflineSyncTelemetryPostBody = OfflineSyncTelemetryBuckets;

export function reportOfflineSyncTelemetry(snapshot: OfflineSyncTelemetryPostBody): void {
  if (!getCurrentUserId()?.trim()) return;
  void api.realtime.telemetry(snapshot).catch(() => {});
}

export async function buildOfflineSyncTelemetrySnapshot(): Promise<OfflineSyncTelemetryPostBody> {
  const rows = await getAllPendingSync();
  return computeOfflineSyncTelemetryBuckets(rows, getOfflineSyncSessionCounters());
}

/**
 * Throttled Dexie → telemetry reporter. Reports at most once per
 * {@link MIN_REPORT_INTERVAL_MS}, or immediately when bucket aggregates change.
 */
export async function maybeReportOfflineSyncTelemetry(options?: {
  force?: boolean;
  nowMs?: number;
}): Promise<void> {
  if (!getCurrentUserId()?.trim()) return;
  try {
    const nowMs = options?.nowMs ?? Date.now();
    const buckets = await buildOfflineSyncTelemetrySnapshot();
    const key = snapshotKey(buckets);

    const materialChange = lastSnapshotKey !== null && key !== lastSnapshotKey;
    const intervalElapsed = lastReportAtMs === 0 || nowMs - lastReportAtMs >= MIN_REPORT_INTERVAL_MS;

    if (!options?.force && !intervalElapsed && !materialChange) {
      return;
    }

    lastSnapshotKey = key;
    lastReportAtMs = nowMs;
    reportOfflineSyncTelemetry(buckets);
  } catch {
    // Best-effort: Dexie may be unavailable (SSR, unit tests without IndexedDB).
  }
}

/** Test-only reset of throttle state. */
export function _resetOfflineSyncTelemetryReporterForTests(): void {
  lastReportAtMs = 0;
  lastSnapshotKey = null;
}
