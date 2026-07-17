import type { BoardAnomaly, BoardAnomalySeverity, BoardAnomalyType } from "../../../shared/equipment-board";

/**
 * R-BDF-1.2 — pinned glance-board ranking. Anomaly cards are ordered by, in strict
 * precedence: severity (pressure before calm) → rule priority → `since` age (oldest
 * first) → `unitId` (stable tie-break). The order is deterministic so an
 * equal-priority fixture always lays out the same way.
 */
const SEVERITY_ORDER: Record<BoardAnomalySeverity, number> = {
  pressure: 0,
  calm: 1,
};

/** battery_critical > rfid_reader_offline > cart_unverified (pinned). */
const RULE_PRIORITY: Record<BoardAnomalyType, number> = {
  battery_critical: 0,
  rfid_reader_offline: 1,
  cart_unverified: 2,
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Returns a new, ranked array — never mutates the input. */
export function rankBoardAnomalies(anomalies: readonly BoardAnomaly[]): BoardAnomaly[] {
  return [...anomalies].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      RULE_PRIORITY[a.type] - RULE_PRIORITY[b.type] ||
      // Oldest onset first → the earlier ISO instant sorts ahead.
      compareStrings(a.since, b.since) ||
      compareStrings(a.unitId, b.unitId),
  );
}
