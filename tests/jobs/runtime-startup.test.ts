/**
 * A1 — job runtime startup readiness: runtimeStarted reflects aggregate worker success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => {
  const Worker = vi.fn();
  Worker.mockImplementation(function (this: { on: ReturnType<typeof vi.fn> }) {
    this.on = vi.fn();
  });
  return { Worker };
});

vi.mock("../../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn(),
}));

vi.mock("../../server/jobs/queue-factory.js", () => ({
  getOrCreateQueue: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../server/workers/chargeAlertWorker.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../server/workers/chargeAlertWorker.js")>();
  return {
    ...mod,
    bindChargeAlertProducerQueue: vi.fn(),
    processChargeAlertJob: vi.fn(),
  };
});

vi.mock("../../server/workers/inventory-deduction.worker.js", () => ({
  processInventoryDeductionJob: vi.fn(),
}));

import { Worker } from "bullmq";
import { createRedisConnection } from "../../server/lib/redis.js";
import { getOrCreateQueue } from "../../server/jobs/queue-factory.js";
import { INVENTORY_DEDUCTION_QUEUE_NAME } from "../../server/queues/inventory-deduction.queue.js";
import { CHARGE_ALERT_QUEUE_NAME } from "../../server/workers/chargeAlertWorker.js";
import {
  getRuntimeReadiness,
  isJobRuntimeStarted,
  resetJobRuntimeStateForTests,
  startJobRuntime,
} from "../../server/jobs/runtime.js";

function fakeRedisConnection() {
  return { quit: vi.fn().mockResolvedValue(undefined) };
}

describe("job runtime startup readiness (A1)", () => {
  beforeEach(() => {
    resetJobRuntimeStateForTests();
    vi.clearAllMocks();
    vi.mocked(getOrCreateQueue).mockResolvedValue({});
  });

  it("sets runtimeStarted when all pilot workers start successfully", async () => {
    vi.mocked(createRedisConnection).mockResolvedValue(
      fakeRedisConnection() as Awaited<ReturnType<typeof createRedisConnection>>,
    );

    await startJobRuntime();

    expect(isJobRuntimeStarted()).toBe(true);
    expect(getRuntimeReadiness()).toEqual({
      started: true,
      workers: [
        { name: INVENTORY_DEDUCTION_QUEUE_NAME, ok: true },
        { name: CHARGE_ALERT_QUEUE_NAME, ok: true },
      ],
    });
    expect(Worker).toHaveBeenCalledTimes(2);
  });

  it("leaves runtimeStarted false when any pilot worker fails to start", async () => {
    vi.mocked(createRedisConnection)
      .mockResolvedValueOnce(
        fakeRedisConnection() as Awaited<ReturnType<typeof createRedisConnection>>,
      )
      .mockResolvedValueOnce(null);

    await startJobRuntime();

    expect(isJobRuntimeStarted()).toBe(false);
    expect(getRuntimeReadiness()).toEqual({
      started: false,
      workers: [
        { name: INVENTORY_DEDUCTION_QUEUE_NAME, ok: true },
        { name: CHARGE_ALERT_QUEUE_NAME, ok: false },
      ],
    });
    expect(Worker).toHaveBeenCalledTimes(1);
  });
});
