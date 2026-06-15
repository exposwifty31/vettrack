/**
 * OFF-08 — client offline queue telemetry: bucket computation + throttled reporter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSync } from "../src/lib/offline-db";
import {
  bucketConflictCount,
  bucketDeadLetterCount,
  bucketOldestPendingAgeMs,
  bucketPendingCount,
  bucketSessionOutcomeCount,
  computeOfflineSyncTelemetryBuckets,
} from "../src/lib/offline-sync-telemetry";
import {
  _resetOfflineSyncSessionCountersForTests,
  recordOfflineSyncSessionSuccess,
} from "../src/lib/offline-sync-session-counters";
import {
  _resetOfflineSyncTelemetryReporterForTests,
  maybeReportOfflineSyncTelemetry,
  MIN_REPORT_INTERVAL_MS,
} from "../src/lib/offline-sync-telemetry-reporter";
import { setAuthState } from "../src/lib/auth-store";

function row(partial: Partial<PendingSync> & Pick<PendingSync, "status">): PendingSync {
  const createdAt = partial.createdAt ?? new Date("2026-05-26T12:00:00.000Z");
  return {
    id: partial.id ?? 1,
    type: "scan",
    endpoint: "/api/equipment/x/scan",
    method: "POST",
    body: "{}",
    createdAt,
    retries: 0,
    status: partial.status,
    clientTimestamp: 1,
    clientMutationId: "m1",
    idempotencyKey: "k1",
    schemaVersion: 2,
    updatedAt: createdAt,
    structuredError: null,
    ...partial,
  };
}

describe("OFF-08 computeOfflineSyncTelemetryBuckets", () => {
  const now = new Date("2026-05-26T12:10:00.000Z");
  const emptySession = { syncSuccessReports: 0, syncConflictReports: 0, syncDeadReports: 0 };

  it("maps empty queue to zero / none buckets", () => {
    expect(computeOfflineSyncTelemetryBuckets([], emptySession, now)).toEqual({
      offlineSyncPendingCountBucket: "0",
      offlineSyncOldestPendingAgeBucket: "none",
      offlineSyncDeadLetterBucket: "0",
      offlineSyncConflictBucket: "0",
      offlineSyncSessionSuccessBucket: "0",
      offlineSyncSessionConflictBucket: "0",
      offlineSyncSessionDeadBucket: "0",
    });
  });

  it("counts pending + processing for depth and oldest age", () => {
    const rows = [
      row({
        id: 1,
        status: "pending",
        createdAt: new Date("2026-05-26T12:09:30.000Z"),
      }),
      row({
        id: 2,
        status: "processing",
        createdAt: new Date("2026-05-26T12:08:00.000Z"),
      }),
      row({ id: 3, status: "synced", createdAt: new Date("2026-05-26T11:00:00.000Z") }),
    ];
    const buckets = computeOfflineSyncTelemetryBuckets(rows, emptySession, now);
    expect(buckets.offlineSyncPendingCountBucket).toBe("2_5");
    expect(buckets.offlineSyncOldestPendingAgeBucket).toBe("lt_5m");
  });

  it("includes legacy failed in dead-letter bucket with dead rows", () => {
    const rows = [
      row({ id: 1, status: "dead" }),
      row({ id: 2, status: "failed" }),
      row({ id: 3, status: "conflict" }),
    ];
    const buckets = computeOfflineSyncTelemetryBuckets(rows, emptySession, now);
    expect(buckets.offlineSyncDeadLetterBucket).toBe("2_plus");
    expect(buckets.offlineSyncConflictBucket).toBe("1_plus");
  });

  it("bucket helpers cover boundary values", () => {
    expect(bucketPendingCount(0)).toBe("0");
    expect(bucketPendingCount(6)).toBe("6_plus");
    expect(bucketOldestPendingAgeMs(30_000)).toBe("lt_60s");
    expect(bucketOldestPendingAgeMs(3 * 60_000)).toBe("lt_5m");
    expect(bucketOldestPendingAgeMs(2 * 60 * 60_000)).toBe("gte_1h");
    expect(bucketDeadLetterCount(2)).toBe("2_plus");
    expect(bucketConflictCount(0)).toBe("0");
    expect(bucketSessionOutcomeCount(6)).toBe("6_plus");
  });

  it("reflects session counters in session buckets", () => {
    _resetOfflineSyncSessionCountersForTests();
    recordOfflineSyncSessionSuccess();
    recordOfflineSyncSessionSuccess();
    const buckets = computeOfflineSyncTelemetryBuckets([], {
      syncSuccessReports: 2,
      syncConflictReports: 0,
      syncDeadReports: 0,
    });
    expect(buckets.offlineSyncSessionSuccessBucket).toBe("1_5");
  });
});

describe("OFF-08 maybeReportOfflineSyncTelemetry throttle", () => {
  beforeEach(() => {
    _resetOfflineSyncTelemetryReporterForTests();
    _resetOfflineSyncSessionCountersForTests();
    setAuthState({
      userId: "telemetry-test-user",
      email: "telemetry@test.local",
      name: "Telemetry Test",
      bearerToken: null,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts telemetry at most once per MIN_REPORT_INTERVAL_MS unless buckets change", async () => {
    vi.spyOn(await import("../src/lib/offline-db"), "getAllPendingSync").mockResolvedValue([]);

    const postSpy = vi
      .spyOn((await import("../src/lib/api")).api.realtime, "telemetry")
      .mockResolvedValue({ ok: true });

    const t0 = Date.now();
    await maybeReportOfflineSyncTelemetry({ force: true, nowMs: t0 });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[0]).toMatchObject({
      offlineSyncPendingCountBucket: "0",
      offlineSyncOldestPendingAgeBucket: "none",
    });

    await maybeReportOfflineSyncTelemetry({ nowMs: t0 + 1000 });
    expect(postSpy).toHaveBeenCalledTimes(1);

    await maybeReportOfflineSyncTelemetry({ nowMs: t0 + MIN_REPORT_INTERVAL_MS });
    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});
