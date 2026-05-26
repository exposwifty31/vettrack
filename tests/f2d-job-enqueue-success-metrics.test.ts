/**
 * F2d — bounded enqueue-success observability (mirror of F2c).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";
import {
  buildJobRegistryMetrics,
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

const DEFAULT_JOB_REGISTRY_COUNTERS = {
  replayIdempotencyCollision: 0,
  jobRuntimeUnknownJobName: 0,
  legacyWorkerStarterUsed: 0,
  jobRuntimeWorkerUnavailable: 0,
  jobEnqueueQueueUnavailable: 0,
  jobEnqueueSucceeded: 0,
};

describe("F2d — job_enqueue_succeeded metric", () => {
  beforeEach(() => {
    resetMetrics();
    resetQueueFactoryForTests();
    getOrCreateQueueMock.mockReset();
  });

  it("includes jobEnqueueSucceeded at zero in getMetricsSnapshot().jobRegistry", () => {
    expect(getMetricsSnapshot().jobRegistry).toEqual({
      ...DEFAULT_JOB_REGISTRY_COUNTERS,
      runtimeReadiness: { started: false, workers: [] },
    });
  });

  it("maps incrementMetric('job_enqueue_succeeded') into jobRegistry snapshot", () => {
    incrementMetric("job_enqueue_succeeded", 1);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueSucceeded).toBe(1);
  });

  it("silently drops unknown metric names (regression)", () => {
    incrementMetric("job_enqueue_succeeded_clinic_x", 99);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueSucceeded).toBe(0);
  });

  it("buildJobRegistryMetrics includes jobEnqueueSucceeded", () => {
    incrementMetric("job_enqueue_succeeded");
    expect(buildJobRegistryMetrics().jobEnqueueSucceeded).toBe(1);
  });

  it("jobRegistry has exactly six counter keys plus runtimeReadiness", () => {
    incrementMetric("job_enqueue_succeeded_extra_label", 99);
    const registry = getMetricsSnapshot().jobRegistry as Record<string, unknown>;
    expect(Object.keys(registry).sort()).toEqual(
      [
        "replayIdempotencyCollision",
        "jobRuntimeUnknownJobName",
        "legacyWorkerStarterUsed",
        "jobRuntimeWorkerUnavailable",
        "jobEnqueueQueueUnavailable",
        "jobEnqueueSucceeded",
        "runtimeReadiness",
      ].sort(),
    );
  });
});

describe("F2d — enqueueJob success observability", () => {
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

  it("increments success counter and logs on successful enqueue", async () => {
    const mockJob = { id: "job-1" } as Job;
    const addMock = vi.fn().mockResolvedValue(mockJob);
    getOrCreateQueueMock.mockResolvedValue({ add: addMock });

    const result = await enqueueJob("check-plug", {
      returnId: "r1",
      equipmentId: "e1",
      clinicId: "c1",
    });

    expect(result).toBe(mockJob);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueSucceeded).toBe(1);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith("[job-enqueue]", {
      event: "job_enqueue_succeeded",
      kind: "check-plug",
      queueName: "charge-alert",
    });
  });

  it("does not increment success when getOrCreateQueue fails (unavailable only)", async () => {
    getOrCreateQueueMock.mockRejectedValue(
      new Error("charge-alert queue disabled: REDIS_URL missing"),
    );

    await expect(
      enqueueJob("check-plug", {
        returnId: "r1",
        equipmentId: "e1",
        clinicId: "c1",
      }),
    ).rejects.toThrow(/REDIS_URL missing/);

    expect(getMetricsSnapshot().jobRegistry.jobEnqueueSucceeded).toBe(0);
    expect(getMetricsSnapshot().jobRegistry.jobEnqueueQueueUnavailable).toBe(1);
  });
});

describe("F2d — enqueueIntegrationSyncJob success observability", () => {
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

  it("increments success with integration-sync-enqueue kind", async () => {
    const mockJob = { id: "int-1" } as Job;
    getOrCreateQueueMock.mockResolvedValue({
      add: vi.fn().mockResolvedValue(mockJob),
    });

    await enqueueIntegrationSyncJob({
      clinicId: "clinic-1",
      adapterId: "vetspire",
      syncType: "billing",
      direction: "outbound",
    });

    expect(getMetricsSnapshot().jobRegistry.jobEnqueueSucceeded).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[job-enqueue]",
      expect.objectContaining({
        event: "job_enqueue_succeeded",
        kind: "integration-sync-enqueue",
        queueName: expect.any(String),
      }),
    );
  });
});
