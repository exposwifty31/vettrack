/**
 * Pure analytics KPI derivations (Phase 7e). Kept DB-free so the ratio/dwell/delta
 * math is unit-testable. Every metric here is grounded in a real, persisted column;
 * nothing is proxied. Callers pass already-fetched rows + counts.
 */

export type EquipmentKpiRow = {
  readinessState: string | null;
  readinessStateSince: Date | string | null;
  custodyState: string | null;
  usageState: string | null;
  roomId: string | null;
  status: string | null;
};

export type ReadinessKpi = {
  ready: number;
  notReady: number;
  unknown: number;
  readyPct: number;
  /** Avg dwell (seconds) of equipment CURRENTLY not_ready. Null when none. Backlog age — NOT time-to-ready. */
  avgNotReadyDwellSeconds: number | null;
};

export type OccupancyKpi = {
  /** Point-in-time only — a ratio, never a time-weighted "utilization". */
  currentlyCheckedOutPct: number;
  currentlyInUsePct: number;
};

export type PerRoomRow = {
  roomId: string;
  roomName: string;
  total: number;
  inUse: number;
  ok: number;
  issue: number;
  maintenance: number;
  sterilized: number;
};

export type TaskOnTimeKpi = {
  onTimeCount: number;
  completedCount: number;
  onTimePct: number | null;
  previousPct: number | null;
  deltaPct: number | null;
};

/** Bucket sentinel for equipment with no assigned room (matches the command board). */
export const UNASSIGNED_ROOM_ID = "__unassigned__";

const IN_USE_STATES = new Set(["in_use", "emergency_use"]);
const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0);

export function computeReadiness(rows: EquipmentKpiRow[], nowMs: number): ReadinessKpi {
  let ready = 0;
  let notReady = 0;
  let unknown = 0;
  let dwellSum = 0;
  let dwellCount = 0;
  for (const r of rows) {
    const state = r.readinessState ?? "unknown";
    if (state === "ready") {
      ready++;
    } else if (state === "not_ready") {
      notReady++;
      if (r.readinessStateSince) {
        const since = new Date(r.readinessStateSince).getTime();
        if (!Number.isNaN(since)) {
          dwellSum += nowMs - since;
          dwellCount++;
        }
      }
    } else {
      unknown++;
    }
  }
  return {
    ready,
    notReady,
    unknown,
    readyPct: pct(ready, rows.length),
    avgNotReadyDwellSeconds: dwellCount > 0 ? Math.round(dwellSum / dwellCount / 1000) : null,
  };
}

export function computeOccupancy(rows: EquipmentKpiRow[]): OccupancyKpi {
  let checkedOut = 0;
  let inUse = 0;
  for (const r of rows) {
    if (r.custodyState === "checked_out") checkedOut++;
    if (r.usageState && IN_USE_STATES.has(r.usageState)) inUse++;
  }
  return {
    currentlyCheckedOutPct: pct(checkedOut, rows.length),
    currentlyInUsePct: pct(inUse, rows.length),
  };
}

export function computePerRoom(rows: EquipmentKpiRow[], roomNameById: Map<string, string>): PerRoomRow[] {
  const byRoom = new Map<string, PerRoomRow>();
  for (const r of rows) {
    const roomId = r.roomId ?? UNASSIGNED_ROOM_ID;
    let bucket = byRoom.get(roomId);
    if (!bucket) {
      bucket = {
        roomId,
        roomName: roomId === UNASSIGNED_ROOM_ID ? "" : roomNameById.get(roomId) ?? "",
        total: 0,
        inUse: 0,
        ok: 0,
        issue: 0,
        maintenance: 0,
        sterilized: 0,
      };
      byRoom.set(roomId, bucket);
    }
    bucket.total++;
    if (r.usageState && IN_USE_STATES.has(r.usageState)) bucket.inUse++;
    switch (r.status) {
      case "ok": bucket.ok++; break;
      case "issue": bucket.issue++; break;
      case "maintenance": bucket.maintenance++; break;
      case "sterilized": bucket.sterilized++; break;
    }
  }
  return [...byRoom.values()].sort((a, b) => b.total - a.total);
}

/** One-decimal on-time percentage from raw counts; null when no completions in the window. */
function onTimePctOf(counts: { onTimeCount: number; completedCount: number }): number | null {
  return counts.completedCount > 0
    ? Math.round((counts.onTimeCount / counts.completedCount) * 1000) / 10
    : null;
}

export function computeOnTime(
  current: { onTimeCount: number; completedCount: number },
  previous: { onTimeCount: number; completedCount: number },
): TaskOnTimeKpi {
  const onTimePct = onTimePctOf(current);
  const previousPct = onTimePctOf(previous);
  const deltaPct =
    onTimePct !== null && previousPct !== null ? Math.round((onTimePct - previousPct) * 10) / 10 : null;
  return {
    onTimeCount: current.onTimeCount,
    completedCount: current.completedCount,
    onTimePct,
    previousPct,
    deltaPct,
  };
}
