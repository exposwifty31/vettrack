/** In-memory session counters for OFF-08 (since tab load; not persisted). */

let syncSuccessReports = 0;
let syncConflictReports = 0;
let syncDeadReports = 0;

export function getOfflineSyncSessionCounters(): {
  syncSuccessReports: number;
  syncConflictReports: number;
  syncDeadReports: number;
} {
  return {
    syncSuccessReports,
    syncConflictReports,
    syncDeadReports,
  };
}

export function recordOfflineSyncSessionSuccess(): void {
  syncSuccessReports++;
}

export function recordOfflineSyncSessionConflict(): void {
  syncConflictReports++;
}

export function recordOfflineSyncSessionDead(): void {
  syncDeadReports++;
}

/** Test-only reset. */
export function _resetOfflineSyncSessionCountersForTests(): void {
  syncSuccessReports = 0;
  syncConflictReports = 0;
  syncDeadReports = 0;
}
