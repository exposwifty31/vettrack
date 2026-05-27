/**
 * Stretch-A — pure idle detector for post-sync reconciliation checkpoint.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateSyncQueueIdle,
  type SyncQueueIdleSnapshot,
} from "../src/lib/sync-queue-idle";

function snap(overrides: Partial<SyncQueueIdleSnapshot> = {}): SyncQueueIdleSnapshot {
  return {
    isSyncing: false,
    pendingReplayCount: 0,
    hasScheduledBurst: false,
    isCircuitOpen: false,
    haltQueue: false,
    ...overrides,
  };
}

describe("evaluateSyncQueueIdle", () => {
  it("reports idle when queue has no blockers", () => {
    expect(evaluateSyncQueueIdle(snap())).toEqual({ isIdle: true, reason: "idle" });
  });

  it("is not idle while syncing", () => {
    expect(evaluateSyncQueueIdle(snap({ isSyncing: true }))).toEqual({
      isIdle: false,
      reason: "syncing",
    });
  });

  it("is not idle when pending replay rows remain", () => {
    expect(evaluateSyncQueueIdle(snap({ pendingReplayCount: 3 }))).toEqual({
      isIdle: false,
      reason: "pending_replay",
    });
  });

  it("is not idle when a burst continuation is scheduled", () => {
    expect(evaluateSyncQueueIdle(snap({ hasScheduledBurst: true }))).toEqual({
      isIdle: false,
      reason: "burst_scheduled",
    });
  });

  it("is not idle when the circuit breaker is open", () => {
    expect(evaluateSyncQueueIdle(snap({ isCircuitOpen: true }))).toEqual({
      isIdle: false,
      reason: "circuit_open",
    });
  });

  it("is not idle when the queue is halted", () => {
    expect(evaluateSyncQueueIdle(snap({ haltQueue: true }))).toEqual({
      isIdle: false,
      reason: "halted",
    });
  });

  it("prioritizes halted over syncing when both are set", () => {
    expect(
      evaluateSyncQueueIdle(snap({ haltQueue: true, isSyncing: true, pendingReplayCount: 5 })),
    ).toEqual({ isIdle: false, reason: "halted" });
  });
});
