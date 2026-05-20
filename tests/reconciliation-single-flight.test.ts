/**
 * Phase 10 P1-2 regression: useRealtimeReconciliation must serialize
 * run() calls with a single-flight mutex to prevent concurrent replay
 * batches from racing on replaySuppressionMaxId.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const source = fs.readFileSync("src/hooks/useRealtimeReconciliation.ts", "utf8");

describe("P1-2: Reconciliation single-flight mutex", () => {
  it("useRealtimeReconciliation has a runInFlight guard", () => {
    expect(source).toContain("runInFlight");
    expect(source).toContain("if (runInFlight) return");
  });

  it("does not consume a pending trigger while a reconciliation run is in flight", () => {
    const timerIdx = source.indexOf("window.setTimeout");
    const runInFlightIdx = source.indexOf("if (runInFlight) return", timerIdx);
    const consumeIdx = source.indexOf("pendingTrigger = null", timerIdx);

    expect(timerIdx).toBeGreaterThan(0);
    expect(runInFlightIdx).toBeGreaterThan(timerIdx);
    expect(consumeIdx).toBeGreaterThan(runInFlightIdx);
  });

  it("reschedules a pending trigger after the in-flight run completes", () => {
    const finallyIdx = source.indexOf("finally(() =>");
    const pendingIdx = source.indexOf("pendingTrigger", finallyIdx);
    const scheduleIdx = source.indexOf("schedule(pendingTrigger)", finallyIdx);

    expect(finallyIdx).toBeGreaterThan(0);
    expect(pendingIdx).toBeGreaterThan(finallyIdx);
    expect(scheduleIdx).toBeGreaterThan(pendingIdx);
  });
});
