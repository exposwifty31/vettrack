/**
 * @vitest-environment happy-dom
 *
 * Phase 5 (C2) — calm/pressure mode machine. Pressure enters immediately on the
 * trigger (activeEmergency OR critical alerts >= threshold) and leaves only after
 * an EXIT-ONLY hysteresis window; a re-trigger within the window cancels the exit.
 * Derived purely from the polled snapshot — no timers for entry, only for exit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useBoardMode,
  PRESSURE_ALERT_THRESHOLD,
  PRESSURE_EXIT_HOLD_MS,
} from "@/features/command-board/use-board-mode";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

function boardWith({ criticals = 0, emergency = false }: { criticals?: number; emergency?: boolean }): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-07-08T00:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: 0, ready: 0, inUse: 0, blocked: 0, stale: 0, overdue: 0, unknown: 0,
      belowThresholdTypes: 0, activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: [],
    alerts: Array.from({ length: criticals }, (_, i) => ({
      id: `a${i}`,
      type: "critical_unit_blocked" as const,
      severity: "critical" as const,
      message: "x",
    })),
    activeEmergency: emergency
      ? { sessionId: "s1", startedAt: "2026-07-08T00:00:00.000Z", elapsedMs: 0, linkedEquipment: [] }
      : undefined,
    roiSignals: {
      overusedUnits: [], underusedUnits: [], repairReplaceCandidates: [], typeShortages: [], duplicatePurchaseRisks: [],
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useBoardMode", () => {
  it("stays calm below the alert threshold", () => {
    const { result } = renderHook(() => useBoardMode(boardWith({ criticals: PRESSURE_ALERT_THRESHOLD - 1 })));
    expect(result.current).toBe("calm");
  });

  it("enters pressure immediately at the alert threshold (no entry delay)", () => {
    const { result } = renderHook(() => useBoardMode(boardWith({ criticals: PRESSURE_ALERT_THRESHOLD })));
    expect(result.current).toBe("pressure");
  });

  it("enters pressure on an active emergency regardless of alert count", () => {
    const { result } = renderHook(() => useBoardMode(boardWith({ criticals: 0, emergency: true })));
    expect(result.current).toBe("pressure");
  });

  it("holds pressure across the hysteresis window after the trigger clears, then goes calm", () => {
    const { result, rerender } = renderHook(({ b }: { b: EquipmentCommandBoardSnapshot }) => useBoardMode(b), {
      initialProps: { b: boardWith({ criticals: PRESSURE_ALERT_THRESHOLD }) },
    });
    expect(result.current).toBe("pressure");
    rerender({ b: boardWith({ criticals: 0 }) });
    expect(result.current).toBe("pressure"); // held, not dropped immediately
    act(() => vi.advanceTimersByTime(PRESSURE_EXIT_HOLD_MS - 1));
    expect(result.current).toBe("pressure");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("calm");
  });

  it("a re-trigger within the window cancels the pending exit", () => {
    const { result, rerender } = renderHook(({ b }: { b: EquipmentCommandBoardSnapshot }) => useBoardMode(b), {
      initialProps: { b: boardWith({ criticals: PRESSURE_ALERT_THRESHOLD }) },
    });
    rerender({ b: boardWith({ criticals: 0 }) });
    act(() => vi.advanceTimersByTime(PRESSURE_EXIT_HOLD_MS - 100));
    rerender({ b: boardWith({ criticals: PRESSURE_ALERT_THRESHOLD }) }); // re-trigger before exit
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe("pressure");
  });
});
