import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockConnectionQuit = vi.fn().mockResolvedValue(undefined);

const {
  mockWorkerCtor,
  mockQueueCtor,
  mockQueueAdd,
  mockProcessInventory,
  mockProcessChargeAlert,
  mockRunExpiryCheck,
  mockRunStaleCheckInSweep,
  mockBindQueue,
} = vi.hoisted(() => ({
  mockWorkerCtor: vi.fn(),
  mockQueueCtor: vi.fn(),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockProcessInventory: vi.fn().mockResolvedValue(undefined),
  mockProcessChargeAlert: vi.fn().mockResolvedValue(undefined),
  mockRunExpiryCheck: vi.fn().mockResolvedValue(0),
  mockRunStaleCheckInSweep: vi.fn().mockResolvedValue({}),
  mockBindQueue: vi.fn(),
}));

vi.mock("bullmq", () => {
  function WorkerMock(
    this: { on: typeof mockWorkerOn; close: typeof mockWorkerClose },
    queueName: string,
    processor: (job: Job) => Promise<void>,
    opts: unknown,
  ) {
    mockWorkerCtor(queueName, processor, opts);
    this.on = mockWorkerOn;
    this.close = mockWorkerClose;
  }
  function QueueMock() {
    mockQueueCtor();
    return { on: vi.fn(), add: mockQueueAdd };
  }
  return { Worker: WorkerMock, Queue: QueueMock };
});

vi.mock("../../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn(),
  getRedisUrl: vi.fn().mockReturnValue("redis://127.0.0.1:6379"),
}));

vi.mock("../../server/workers/inventory-deduction.worker.js", () => ({
  processInventoryDeductionJob: mockProcessInventory,
}));

vi.mock("../../server/workers/expiryCheckWorker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/workers/expiryCheckWorker.js")>();
  return {
    ...actual,
    runExpiryCheckWorker: mockRunExpiryCheck,
  };
});

vi.mock("../../server/workers/staleCheckInSweepWorker.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../server/workers/staleCheckInSweepWorker.js")
  >();
  return {
    ...actual,
    isStaleCheckInSweepEnabled: vi.fn().mockReturnValue(true),
    runStaleCheckInSweep: mockRunStaleCheckInSweep,
  };
});

vi.mock("../../server/workers/chargeAlertWorker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/workers/chargeAlertWorker.js")>();
  return {
    ...actual,
    processChargeAlertJob: mockProcessChargeAlert,
    bindChargeAlertProducerQueue: mockBindQueue,
  };
});

import { createRedisConnection } from "../../server/lib/redis.js";
import {
  closeJobRuntime,
  resetJobRuntimeStateForTests,
  startJobRuntime,
} from "../../server/jobs/runtime.js";
import { resetQueueFactoryForTests } from "../../server/jobs/queue-factory.js";
import { INVENTORY_DEDUCTION_QUEUE_NAME } from "../../server/queues/inventory-deduction.queue.js";

function mockRedisConnection() {
  return { quit: mockConnectionQuit, on: vi.fn() };
}

describe("startJobRuntime", () => {
  beforeEach(() => {
    resetJobRuntimeStateForTests();
    resetQueueFactoryForTests();
    mockWorkerCtor.mockClear();
    mockQueueCtor.mockClear();
    mockProcessInventory.mockClear();
    mockProcessChargeAlert.mockClear();
    mockRunExpiryCheck.mockClear();
    mockRunStaleCheckInSweep.mockClear();
    mockQueueAdd.mockClear();
    mockBindQueue.mockClear();
    mockWorkerClose.mockClear();
    mockConnectionQuit.mockClear();
    vi.mocked(createRedisConnection).mockReset();
  });

  it("does not throw when Redis is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(createRedisConnection).mockResolvedValue(null);
    await expect(startJobRuntime()).resolves.toBeUndefined();
    expect(mockWorkerCtor).not.toHaveBeenCalled();

    const unavailableWarns = warnSpy.mock.calls
      .map((call) => call[1] as Record<string, unknown> | undefined)
      .filter((fields) => fields?.event === "job_runtime_worker_unavailable");

    expect(unavailableWarns).toHaveLength(4);
    expect(unavailableWarns).toEqual(
      expect.arrayContaining([
        {
          event: "job_runtime_worker_unavailable",
          queueName: INVENTORY_DEDUCTION_QUEUE_NAME,
          reason: "REDIS_UNAVAILABLE",
        },
        {
          event: "job_runtime_worker_unavailable",
          queueName: "charge-alert",
          reason: "REDIS_UNAVAILABLE",
        },
        {
          event: "job_runtime_worker_unavailable",
          queueName: "expiry-check",
          reason: "REDIS_UNAVAILABLE",
        },
        {
          event: "job_runtime_worker_unavailable",
          queueName: "stale-checkin-sweep",
          reason: "REDIS_UNAVAILABLE",
        },
      ]),
    );
    for (const fields of unavailableWarns) {
      expect(fields).not.toHaveProperty("body");
      expect(fields).not.toHaveProperty("payload");
      expect(fields).not.toHaveProperty("data");
      expect(fields).not.toHaveProperty("clinicId");
    }

    warnSpy.mockRestore();
  });

  it("starts one worker per pilot queue with dedicated connections", async () => {
    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();

    expect(mockBindQueue).toHaveBeenCalled();
    expect(mockWorkerCtor).toHaveBeenCalledTimes(4);
    expect(mockWorkerCtor.mock.calls[0]?.[0]).toBe(INVENTORY_DEDUCTION_QUEUE_NAME);
    expect(mockWorkerCtor.mock.calls[1]?.[0]).toBe("charge-alert");
    expect(mockWorkerCtor.mock.calls[2]?.[0]).toBe("expiry-check");
    expect(mockWorkerCtor.mock.calls[3]?.[0]).toBe("stale-checkin-sweep");
    expect(mockWorkerCtor.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it("throws on unknown job.name for pilot inventory queue", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();

    const inventoryCall = mockWorkerCtor.mock.calls.find(
      (c) => c[0] === INVENTORY_DEDUCTION_QUEUE_NAME,
    );
    const processor = inventoryCall?.[1] as (job: Job) => Promise<void>;

    await expect(
      processor({
        id: "j1",
        name: "unknown-job",
        data: { clinicId: "c1", taskId: "t1" },
        attemptsMade: 0,
      } as Job),
    ).rejects.toThrow(/No JobDefinition for queue=inventory-deduction/);

    expect(mockProcessInventory).not.toHaveBeenCalled();

    const unknownJobWarn = warnSpy.mock.calls.find(
      (call) => call[1] && (call[1] as Record<string, unknown>).event === "job_runtime_unknown_job_name",
    );
    expect(unknownJobWarn).toBeDefined();
    const [, fields] = unknownJobWarn as [string, Record<string, unknown>];
    expect(fields).toEqual({
      event: "job_runtime_unknown_job_name",
      queueName: INVENTORY_DEDUCTION_QUEUE_NAME,
      jobName: "unknown-job",
    });
    expect(fields).not.toHaveProperty("body");
    expect(fields).not.toHaveProperty("payload");
    expect(fields).not.toHaveProperty("data");
    expect(JSON.stringify(unknownJobWarn)).not.toContain("taskId");

    warnSpy.mockRestore();
  });

  it("dispatches known inventory-deduction jobs to processInventoryDeductionJob", async () => {
    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();

    const inventoryCall = mockWorkerCtor.mock.calls.find(
      (c) => c[0] === INVENTORY_DEDUCTION_QUEUE_NAME,
    );
    const processor = inventoryCall?.[1] as (job: Job) => Promise<void>;

    const payload = {
      taskId: "t1",
      containerId: "cont1",
      requiredVolumeMl: 1,
      clinicId: "c1",
      animalId: null,
    };
    await processor({
      id: "j2",
      name: "inventory-deduction",
      data: payload,
      attemptsMade: 0,
    } as Job);

    expect(mockProcessInventory).toHaveBeenCalledWith(payload);
  });

  it("dispatches check-expiry jobs to runExpiryCheckWorker", async () => {
    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();

    const expiryCall = mockWorkerCtor.mock.calls.find((c) => c[0] === "expiry-check");
    const processor = expiryCall?.[1] as (job: Job) => Promise<void>;

    await processor({
      id: "j3",
      name: "check-expiry",
      data: {},
      attemptsMade: 0,
    } as Job);

    expect(mockRunExpiryCheck).toHaveBeenCalled();
  });

  it("registers cron repeat jobs for expiry-check and stale-checkin-sweep", async () => {
    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "check-expiry",
      {},
      expect.objectContaining({
        jobId: "repeat-expiry-check",
        repeat: { pattern: "0 8 * * *" },
      }),
    );
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "sweep-stale-checkins",
      {},
      expect.objectContaining({
        jobId: "repeat-stale-checkin-sweep",
        repeat: { pattern: "17 */6 * * *" },
      }),
    );
  });

  it("closeJobRuntime closes workers and connections", async () => {
    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();
    await closeJobRuntime();

    expect(mockWorkerClose).toHaveBeenCalled();
    expect(mockConnectionQuit).toHaveBeenCalled();
  });
});
