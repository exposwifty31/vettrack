import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockConnectionQuit = vi.fn().mockResolvedValue(undefined);

const { mockWorkerCtor, mockQueueCtor, mockProcessInventory, mockProcessChargeAlert, mockBindQueue } =
  vi.hoisted(() => ({
    mockWorkerCtor: vi.fn(),
    mockQueueCtor: vi.fn(),
    mockProcessInventory: vi.fn().mockResolvedValue(undefined),
    mockProcessChargeAlert: vi.fn().mockResolvedValue(undefined),
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
    return { on: vi.fn() };
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
    mockBindQueue.mockClear();
    mockWorkerClose.mockClear();
    mockConnectionQuit.mockClear();
    vi.mocked(createRedisConnection).mockReset();
  });

  it("does not throw when Redis is unavailable", async () => {
    vi.mocked(createRedisConnection).mockResolvedValue(null);
    await expect(startJobRuntime()).resolves.toBeUndefined();
    expect(mockWorkerCtor).not.toHaveBeenCalled();
  });

  it("starts one worker per pilot queue with dedicated connections", async () => {
    vi.mocked(createRedisConnection).mockImplementation(async () =>
      mockRedisConnection() as never,
    );

    await startJobRuntime();

    expect(mockBindQueue).toHaveBeenCalled();
    expect(mockWorkerCtor).toHaveBeenCalledTimes(2);
    expect(mockWorkerCtor.mock.calls[0]?.[0]).toBe(INVENTORY_DEDUCTION_QUEUE_NAME);
    expect(mockWorkerCtor.mock.calls[1]?.[0]).toBe("charge-alert");
    expect(mockWorkerCtor.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it("throws on unknown job.name for pilot inventory queue", async () => {
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
