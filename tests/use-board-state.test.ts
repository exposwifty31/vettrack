/**
 * @vitest-environment happy-dom
 *
 * Task 2 — useBoardState exit-only alert hysteresis. Enter "alert" on the very
 * render the classifier says so; leave it only after ALERT_EXIT_HOLD_MS of
 * continuously-non-alert classification (a flap restarts the full hold). The
 * takeover states (stale/unconfigured) bypass the hold entirely — a dead feed
 * must never be masked by a held alert card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoardState, ALERT_EXIT_HOLD_MS } from "../src/features/command-board/use-board-state";
import type { DisplaySnapshot } from "../src/types/safety-surfaces";
import type {
  EquipmentBoardUnitRow,
  EquipmentCommandBoardSnapshot,
  EquipmentReadinessStatus,
} from "../shared/equipment-board";

// Fixture helpers duplicated from tests/board-state-classify.test.ts by design
// (no cross-test-file imports in this repo's test convention).
function makeBoard(over: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-08-13T08:00:00Z",
    clinicId: "c1",
    overview: {
      totalCritical: 12,
      ready: 12,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: [],
    alerts: [],
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
    ...over,
  };
}

function unit(status: EquipmentReadinessStatus): EquipmentBoardUnitRow {
  return {
    equipmentId: "u1",
    displayName: "Vent 1",
    status,
    blockingReasons: [],
    citationsCount: 0,
    truthHref: "/equipment/u1",
  };
}

function makeSnapshot(over: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    currentTime: "10:18",
    currentShift: [],
    hospitalizations: [],
    equipment: [],
    upcomingTasks: [],
    overdueTasks: [],
    activeAlertCount: 0,
    totalOverdueCount: 0,
    crashCartStatus: null,
    codeBlueSession: null,
    commandBoard: makeBoard(),
    responsibles: null,
    ...over,
  };
}

function snapWithDownUnit(): DisplaySnapshot {
  return makeSnapshot({ commandBoard: makeBoard({ criticalUnits: [unit("blocked")] }) });
}

function snapAllClear(): DisplaySnapshot {
  return makeSnapshot();
}

describe("useBoardState alert hysteresis", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enters alert instantly, exits only after 30s continuous clear", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const clearInput = { snapshot: snapAllClear(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    expect(result.current).toBe("alert");
    rerender(clearInput);
    expect(result.current).toBe("alert"); // still held
    act(() => vi.advanceTimersByTime(ALERT_EXIT_HOLD_MS - 1_000));
    rerender(clearInput);
    expect(result.current).toBe("alert");
    act(() => vi.advanceTimersByTime(2_000));
    rerender(clearInput);
    expect(result.current).toBe("all_clear");
  });

  it("non-alert states transition instantly when no hold is pending", () => {
    const clearInput = { snapshot: snapAllClear(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: clearInput });
    expect(result.current).toBe("all_clear");
    const attentionInput = {
      snapshot: makeSnapshot({ commandBoard: makeBoard({ waitlist: { depth: 2 } }) }),
      connection: "live" as const,
    };
    rerender(attentionInput);
    expect(result.current).toBe("attention");
    rerender(clearInput);
    expect(result.current).toBe("all_clear");
  });

  it("flap suppression: re-alert during the hold window restarts the full hold", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const clearInput = { snapshot: snapAllClear(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    rerender(clearInput);
    act(() => vi.advanceTimersByTime(15_000));
    rerender(alertInput); // flap back
    expect(result.current).toBe("alert");
    rerender(clearInput);
    act(() => vi.advanceTimersByTime(ALERT_EXIT_HOLD_MS - 5_000));
    rerender(clearInput);
    expect(result.current).toBe("alert"); // full hold restarted on the flap
    act(() => vi.advanceTimersByTime(6_000));
    rerender(clearInput);
    expect(result.current).toBe("all_clear");
  });

  it("takeovers are NOT held: stale wins instantly even from alert", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    expect(result.current).toBe("alert");
    rerender({ snapshot: snapWithDownUnit(), connection: "stale" as const });
    expect(result.current).toBe("stale");
  });

  it("unconfigured bypasses the hold too", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    rerender({ snapshot: makeSnapshot({ commandBoard: null }), connection: "live" as const });
    expect(result.current).toBe("unconfigured");
  });

  it("exports the documented hold constant", () => {
    expect(ALERT_EXIT_HOLD_MS).toBe(30_000);
  });
});
