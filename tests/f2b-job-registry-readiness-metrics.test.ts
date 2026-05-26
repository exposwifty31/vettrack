/**
 * F2b — jobRegistry.runtimeReadiness on admin metrics snapshot.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => {
  const Worker = vi.fn();
  Worker.mockImplementation(function (this: { on: ReturnType<typeof vi.fn> }) {
    this.on = vi.fn();
  });
  return { Worker };
});

vi.mock("../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn(),
}));

vi.mock("../server/jobs/queue-factory.js", () => ({
  getOrCreateQueue: vi.fn().mockResolvedValue({}),
}));

vi.mock("../server/workers/chargeAlertWorker.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../server/workers/chargeAlertWorker.js")>();
  return {
    ...mod,
    bindChargeAlertProducerQueue: vi.fn(),
    processChargeAlertJob: vi.fn(),
  };
});

vi.mock("../server/workers/inventory-deduction.worker.js", () => ({
  processInventoryDeductionJob: vi.fn(),
}));

import { createRedisConnection } from "../server/lib/redis.js";
import {
  buildJobRegistryMetrics,
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics.js";
import { PILOT_QUEUE_NAMES } from "../server/jobs/definitions/index.js";
import {
  getRuntimeReadiness,
  resetJobRuntimeStateForTests,
  startJobRuntime,
} from "../server/jobs/runtime.js";

const JOB_REGISTRY_COUNTER_KEYS = [
  "replayIdempotencyCollision",
  "jobRuntimeUnknownJobName",
  "legacyWorkerStarterUsed",
  "jobRuntimeWorkerUnavailable",
  "jobEnqueueQueueUnavailable",
] as const;

const DEFAULT_COUNTERS = {
  replayIdempotencyCollision: 0,
  jobRuntimeUnknownJobName: 0,
  legacyWorkerStarterUsed: 0,
  jobRuntimeWorkerUnavailable: 0,
  jobEnqueueQueueUnavailable: 0,
};

const DEFAULT_RUNTIME_READINESS = { started: false, workers: [] as Array<{ name: string; ok: boolean }> };

function expectedJobRegistry(
  counters: typeof DEFAULT_COUNTERS,
  runtimeReadiness: typeof DEFAULT_RUNTIME_READINESS = DEFAULT_RUNTIME_READINESS,
) {
  return { ...counters, runtimeReadiness };
}

function fakeRedisConnection() {
  return { quit: vi.fn().mockResolvedValue(undefined) };
}

describe("F2b — jobRegistry.runtimeReadiness", () => {
  beforeEach(() => {
    resetMetrics();
    resetJobRuntimeStateForTests();
    vi.clearAllMocks();
    vi.mocked(createRedisConnection).mockReset();
  });

  it("includes runtimeReadiness with started boolean and workers array in default snapshot", () => {
    const snap = getMetricsSnapshot();
    expect(snap.jobRegistry.runtimeReadiness).toEqual(DEFAULT_RUNTIME_READINESS);
    expect(typeof snap.jobRegistry.runtimeReadiness.started).toBe("boolean");
    expect(Array.isArray(snap.jobRegistry.runtimeReadiness.workers)).toBe(true);
  });

  it("buildJobRegistryMetrics merges live readiness from getRuntimeReadiness", async () => {
    vi.mocked(createRedisConnection).mockResolvedValue(
      fakeRedisConnection() as Awaited<ReturnType<typeof createRedisConnection>>,
    );
    await startJobRuntime();

    const readiness = getRuntimeReadiness();
    expect(buildJobRegistryMetrics()).toEqual(expectedJobRegistry(DEFAULT_COUNTERS, readiness));
  });

  it("after resetJobRuntimeStateForTests readiness is not started with empty workers", () => {
    resetJobRuntimeStateForTests();
    expect(getMetricsSnapshot().jobRegistry.runtimeReadiness).toEqual(DEFAULT_RUNTIME_READINESS);
    expect(buildJobRegistryMetrics().runtimeReadiness).toEqual(DEFAULT_RUNTIME_READINESS);
  });

  it("does not add extra keys under jobRegistry beyond documented fields", () => {
    incrementMetric("job_runtime_unknown_job_name_extra_label", 99);
    incrementMetric("f1_user_id_alice", 99);
    const registry = getMetricsSnapshot().jobRegistry as Record<string, unknown>;
    expect(Object.keys(registry).sort()).toEqual(
      [...JOB_REGISTRY_COUNTER_KEYS, "runtimeReadiness"].sort(),
    );
  });

  it("worker names stay within pilot queue constants when readiness is populated", async () => {
    vi.mocked(createRedisConnection).mockResolvedValue(
      fakeRedisConnection() as Awaited<ReturnType<typeof createRedisConnection>>,
    );
    await startJobRuntime();

    const { workers } = getMetricsSnapshot().jobRegistry.runtimeReadiness;
    expect(workers).toHaveLength(PILOT_QUEUE_NAMES.length);
    for (const entry of workers) {
      expect((PILOT_QUEUE_NAMES as readonly string[]).includes(entry.name)).toBe(true);
      expect(Object.keys(entry).sort()).toEqual(["name", "ok"]);
    }
  });

  it("F1b/F2c counter mapping unchanged when readiness is present", async () => {
    incrementMetric("job_enqueue_queue_unavailable");
    vi.mocked(createRedisConnection).mockResolvedValue(
      fakeRedisConnection() as Awaited<ReturnType<typeof createRedisConnection>>,
    );
    await startJobRuntime();

    expect(getMetricsSnapshot().jobRegistry).toEqual(
      expectedJobRegistry(
        {
          ...DEFAULT_COUNTERS,
          jobEnqueueQueueUnavailable: 1,
        },
        getRuntimeReadiness(),
      ),
    );
  });
});
