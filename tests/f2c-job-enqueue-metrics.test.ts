/**
 * F2c — bounded enqueue-time queue-unavailable observability.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics.js";
import { enqueueJob, enqueueIntegrationSyncJob } from "../server/jobs/enqueue.js";
import { resetQueueFactoryForTests } from "../server/jobs/queue-factory.js";

const getOrCreateQueueMock = vi.fn();

vi.mock("../server/jobs/queue-factory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/jobs/queue-factory.js")>();
  return {
    ...actual,
    getOrCreateQueue: (...args: unknown[]) => getOrCreateQueueMock(...args),
  };
});

describe("F2c — job_enqueue_queue_unavailable metric", () => {
  beforeEach(() => {
    resetMetrics();
    resetQueueFactoryForTests();
    getOrCreateQueueMock.mockReset();
  });

  it("includes jobEnqueueQueueUnavailable at zero in getMetricsSnapshot().jobRegistry", () => {
    expect(getMetricsSnapshot().jobRegistry).toEqual({
      replayIdempotencyCollision: 0,
      jobRuntimeUnknownJobName: 0,
      legacyWorkerStarterUsed: 0,
      jobRuntimeWorkerUnavailable: 0,
      jobEnqueueQueueUnavailable: 0,
      jobEnqueueSucceeded: 0,
      runtimeReadiness: { started: false, workers: [] },
    });
  });

  it("maps incrementMetric('job_enqueue_queue_unavailable') into jobRegistry snapshot", () => {
    incrementMetric("job_enqueue_queue_unavailable", 1);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(1);
  });

  it("silently drops unknown metric names (regression)", () => {
    incrementMetric("job_enqueue_queue_unavailable_clinic_x", 99);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(0);
  });
});

describe("F2c — enqueueJob queue-unavailable observability", () => {
  let warnSpy: ReturnType<typeof vi.spyOn<typeof console, "warn">>;

  beforeEach(() => {
    resetMetrics();
    resetQueueFactoryForTests();
    getOrCreateQueueMock.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("increments counter, logs structured warn, and rethrows on getOrCreateQueue failure", async () => {
    const factoryError = new Error("charge-alert queue disabled: REDIS_URL missing");
    getOrCreateQueueMock.mockRejectedValue(factoryError);

    await expect(
      enqueueJob("check-plug", {
        returnId: "r1",
        equipmentId: "e1",
        clinicId: "c1",
      }),
    ).rejects.toThrow(factoryError.message);

    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith("[job-enqueue]", {
      event: "job_enqueue_queue_unavailable",
      kind: "check-plug",
      queueName: "charge-alert",
      reason: "REDIS_URL_MISSING",
    });
  });

  it("derives REDIS_CONNECTION_FAILED from factory error message", async () => {
    getOrCreateQueueMock.mockRejectedValue(
      new Error("inventory-deduction queue unavailable: Redis connection failed"),
    );

    await expect(
      enqueueJob("inventory-deduction", {
        taskId: "t1",
        clinicId: "c1",
        containerId: "cont-1",
        requiredVolumeMl: 1,
        animalId: null,
      }),
    ).rejects.toThrow(/Redis connection failed/);

    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[job-enqueue]",
      expect.objectContaining({
        event: "job_enqueue_queue_unavailable",
        kind: "inventory-deduction",
        reason: "REDIS_CONNECTION_FAILED",
      }),
    );
  });
});

describe("F2c — enqueueIntegrationSyncJob queue-unavailable observability", () => {
  let warnSpy: ReturnType<typeof vi.spyOn<typeof console, "warn">>;

  beforeEach(() => {
    resetMetrics();
    resetQueueFactoryForTests();
    getOrCreateQueueMock.mockReset();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("uses the same counter and integration-sync-enqueue kind", async () => {
    getOrCreateQueueMock.mockRejectedValue(
      new Error("integration-sync queue unavailable"),
    );

    await expect(
      enqueueIntegrationSyncJob({
        clinicId: "clinic-1",
        adapterId: "vetspire",
        syncType: "billing",
        direction: "outbound",
      }),
    ).rejects.toThrow(/queue unavailable/);

    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith("[job-enqueue]", {
      event: "job_enqueue_queue_unavailable",
      kind: "integration-sync-enqueue",
      queueName: expect.any(String),
      reason: "QUEUE_INIT_FAILED",
    });
  });
});
