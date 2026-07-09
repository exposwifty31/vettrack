import { describe, it, expect } from "vitest";
import {
  computeReadiness,
  computeOccupancy,
  computePerRoom,
  computeOnTime,
  UNASSIGNED_ROOM_ID,
  type EquipmentKpiRow,
} from "../server/lib/analytics-kpis.js";

const NOW = 1_700_000_000_000;
const row = (o: Partial<EquipmentKpiRow>): EquipmentKpiRow => ({
  readinessState: "unknown",
  readinessStateSince: null,
  custodyState: "docked",
  usageState: "idle",
  roomId: null,
  status: "ok",
  ...o,
});

describe("computeReadiness", () => {
  it("counts states and computes readyPct + not-ready dwell", () => {
    const rows = [
      row({ readinessState: "ready" }),
      row({ readinessState: "ready" }),
      row({ readinessState: "not_ready", readinessStateSince: new Date(NOW - 120_000).toISOString() }),
      row({ readinessState: "unknown" }),
    ];
    const k = computeReadiness(rows, NOW);
    expect(k).toMatchObject({ ready: 2, notReady: 1, unknown: 1, readyPct: 50 });
    expect(k.avgNotReadyDwellSeconds).toBe(120); // 2 minutes
  });

  it("null dwell when nothing is not_ready, and 0 pct on empty", () => {
    expect(computeReadiness([row({ readinessState: "ready" })], NOW).avgNotReadyDwellSeconds).toBeNull();
    expect(computeReadiness([], NOW).readyPct).toBe(0);
  });
});

describe("computeOccupancy", () => {
  it("computes point-in-time checked-out and in-use ratios", () => {
    const rows = [
      row({ custodyState: "checked_out", usageState: "in_use" }),
      row({ custodyState: "docked", usageState: "emergency_use" }),
      row({ custodyState: "docked", usageState: "idle" }),
      row({ custodyState: "docked", usageState: "idle" }),
    ];
    expect(computeOccupancy(rows)).toEqual({ currentlyCheckedOutPct: 25, currentlyInUsePct: 50 });
  });

  it("returns 0/0 for an empty fleet (no divide-by-zero)", () => {
    expect(computeOccupancy([])).toEqual({ currentlyCheckedOutPct: 0, currentlyInUsePct: 0 });
  });
});

describe("computePerRoom", () => {
  it("groups by room with in-use + status breakdown, unassigned bucketed, sorted by total", () => {
    const names = new Map([["r1", "ICU"]]);
    const rows = [
      row({ roomId: "r1", status: "ok", usageState: "in_use" }),
      row({ roomId: "r1", status: "issue" }),
      row({ roomId: null, status: "ok" }),
    ];
    const out = computePerRoom(rows, names);
    expect(out[0]).toMatchObject({ roomId: "r1", roomName: "ICU", total: 2, inUse: 1, ok: 1, issue: 1 });
    expect(out[1]).toMatchObject({ roomId: UNASSIGNED_ROOM_ID, roomName: "", total: 1 });
  });
});

describe("computeOnTime", () => {
  it("computes pct + delta vs the prior window", () => {
    const k = computeOnTime({ onTimeCount: 8, completedCount: 10 }, { onTimeCount: 6, completedCount: 10 });
    expect(k).toMatchObject({ onTimePct: 80, previousPct: 60, deltaPct: 20 });
  });

  it("null pct/delta when a window has no completions", () => {
    const k = computeOnTime({ onTimeCount: 0, completedCount: 0 }, { onTimeCount: 5, completedCount: 5 });
    expect(k.onTimePct).toBeNull();
    expect(k.deltaPct).toBeNull();
  });
});
