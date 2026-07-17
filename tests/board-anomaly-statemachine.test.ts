/**
 * @vitest-environment happy-dom
 *
 * R-BDF-1.2 — single-shot anomaly state machine. Dedup key = (type, unitId);
 * per-key states absent → active (fire once) → cleared. A snapshot where the
 * condition no longer holds transitions the key to cleared; re-fire happens only
 * on a subsequent cleared → active. Distinct keys are independent, and a re-render
 * that carries an identical anomaly set (e.g. a calm↔pressure mode flip) never
 * re-fires. Derives entirely from the already-fetched snapshot — no new transport.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useBoardAnomalyStateMachine,
  boardAnomalyKey,
} from "@/features/command-board/use-board-anomaly-state-machine";
import type { BoardAnomaly, BoardAnomalyType } from "../shared/equipment-board";

function anomaly(
  type: BoardAnomalyType,
  unitId: string,
  since = "2026-07-17T00:00:00.000Z",
): BoardAnomaly {
  const severity = type === "cart_unverified" ? "calm" : "pressure";
  return { type, unitId, severity, since, sourceRef: { table: "vt_equipment", id: unitId } };
}

describe("useBoardAnomalyStateMachine — single-shot (type,unitId) dedup", () => {
  it("fires once per key on the initial (absent → active) transition", () => {
    const onActivate = vi.fn();
    const anomalies = [anomaly("battery_critical", "eq-1")];
    const { result } = renderHook(() => useBoardAnomalyStateMachine(anomalies, onActivate));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(anomalies[0]);
    expect(result.current.activeKeys.has(boardAnomalyKey(anomalies[0]))).toBe(true);
    expect(result.current.justActivatedKeys.has(boardAnomalyKey(anomalies[0]))).toBe(true);
  });

  it("does NOT re-fire when an identical snapshot repeats", () => {
    const onActivate = vi.fn();
    const first = [anomaly("battery_critical", "eq-1")];
    const { result, rerender } = renderHook(
      ({ list }) => useBoardAnomalyStateMachine(list, onActivate),
      { initialProps: { list: first } },
    );
    expect(onActivate).toHaveBeenCalledTimes(1);

    // A fresh array instance carrying the SAME (type,unitId) — parent re-render.
    rerender({ list: [anomaly("battery_critical", "eq-1")] });

    expect(onActivate).toHaveBeenCalledTimes(1);
    // Held: no longer "just activated" on the repeated snapshot.
    expect(result.current.justActivatedKeys.size).toBe(0);
    expect(result.current.activeKeys.has(boardAnomalyKey(first[0]))).toBe(true);
  });

  it("clears the key when the condition is gone (no fire on clear)", () => {
    const onActivate = vi.fn();
    const { result, rerender } = renderHook(
      ({ list }) => useBoardAnomalyStateMachine(list, onActivate),
      { initialProps: { list: [anomaly("battery_critical", "eq-1")] } },
    );
    expect(onActivate).toHaveBeenCalledTimes(1);

    rerender({ list: [] as BoardAnomaly[] });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(result.current.activeKeys.size).toBe(0);
    expect(result.current.justActivatedKeys.size).toBe(0);
  });

  it("re-fires on reappearance ONLY after a clear (cleared → active)", () => {
    const onActivate = vi.fn();
    const { rerender } = renderHook(
      ({ list }) => useBoardAnomalyStateMachine(list, onActivate),
      { initialProps: { list: [anomaly("battery_critical", "eq-1")] } },
    );
    expect(onActivate).toHaveBeenCalledTimes(1);

    rerender({ list: [] as BoardAnomaly[] }); // clear
    expect(onActivate).toHaveBeenCalledTimes(1);

    rerender({ list: [anomaly("battery_critical", "eq-1")] }); // reappear
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("treats distinct (type,unitId) keys independently", () => {
    const onActivate = vi.fn();
    const { rerender } = renderHook(
      ({ list }) => useBoardAnomalyStateMachine(list, onActivate),
      { initialProps: { list: [anomaly("battery_critical", "eq-1")] } },
    );
    expect(onActivate).toHaveBeenCalledTimes(1);

    // Add a second, distinct key — only the new one fires; eq-1 stays active, no re-fire.
    rerender({
      list: [anomaly("battery_critical", "eq-1"), anomaly("cart_unverified", "cart-9")],
    });
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(onActivate).toHaveBeenLastCalledWith(anomaly("cart_unverified", "cart-9"));

    // Same (type) different unit is a different key → fires.
    rerender({
      list: [
        anomaly("battery_critical", "eq-1"),
        anomaly("cart_unverified", "cart-9"),
        anomaly("battery_critical", "eq-2"),
      ],
    });
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it("does NOT re-fire when only the mode-driven re-render happens (same keys)", () => {
    const onActivate = vi.fn();
    const list = [anomaly("battery_critical", "eq-1"), anomaly("cart_unverified", "cart-9")];
    const { rerender } = renderHook(
      ({ items }) => useBoardAnomalyStateMachine(items, onActivate),
      { initialProps: { items: list } },
    );
    expect(onActivate).toHaveBeenCalledTimes(2);

    // Simulate calm→pressure: the SAME anomalies, only severity-irrelevant re-render.
    rerender({ items: [...list] });
    rerender({ items: [...list] });

    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("keys by (type,unitId) only — a severity flip on the same unit does not re-fire", () => {
    const onActivate = vi.fn();
    const calmish: BoardAnomaly = {
      ...anomaly("battery_critical", "eq-1"),
      severity: "calm",
    };
    const { rerender } = renderHook(
      ({ list }) => useBoardAnomalyStateMachine(list, onActivate),
      { initialProps: { list: [calmish] } },
    );
    expect(onActivate).toHaveBeenCalledTimes(1);

    rerender({ list: [anomaly("battery_critical", "eq-1")] }); // severity now pressure
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
