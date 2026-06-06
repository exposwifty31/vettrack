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

const { mockStartWorkerHeartbeat } = vi.hoisted(() => ({
  mockStartWorkerHeartbeat: vi.fn(),
}));

vi.mock("../../server/lib/worker-heartbeat.js", () => ({
  startWorkerHeartbeat: mockStartWorkerHeartbeat,
}));

vi.mock("../../server/jobs/queue-factory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/jobs/queue-factory.js")>();
  return {
    ...actual,
    getOrCreateQueue: vi.fn().mockResolvedValue({ add: vi.fn().mockResolvedValue(undefined) }),
  };
});

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

vi.mock("../../server/workers/expiryCheckWorker.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../server/workers/expiryCheckWorker.js")>();
  return { ...mod, runExpiryCheckWorker: vi.fn() };
});

vi.mock("../../server/workers/staleCheckInSweepWorker.js", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("../../server/workers/staleCheckInSweepWorker.js")
  >();
  return {
    ...mod,
    isStaleCheckInSweepEnabled: vi.fn().mockReturnValue(true),
    runStaleCheckInSweep: vi.fn(),
  };
});

import { Worker } from "bullmq";
import { createRedisConnection } from "../../server/lib/redis.js";
import { getOrCreateQueue } from "../../server/jobs/queue-factory.js";
import { CHARGE_ALERT_QUEUE_NAME } from "../../server/workers/chargeAlertWorker.js";
import {
  EXPIRY_CHECK_QUEUE_NAME,
  STALE_CHECKIN_SWEEP_QUEUE_NAME,
} from "../../server/jobs/definitions/index.js";
import {
  getRuntimeReadiness,
  isJobRuntimeStarted,
  resetJobRuntimeStateForTests,
  startJobRuntime,
} from "../../server/jobs/runtime.js";
import { resetQueueFactoryForTests } from "../../server/jobs/queue-factory.js";

function fakeRedisConnection() {
  return { quit: vi.fn().mockResolvedValue(undefined) };
}

describe("job runtime startup readiness (A1)", () => {
  beforeEach(() => {
    resetJobRuntimeStateForTests();
    resetQueueFactoryForTests();
    vi.clearAllMocks();
    mockStartWorkerHeartbeat.mockClear();
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
        { name: CHARGE_ALERT_QUEUE_NAME, ok: true },
        { name: EXPIRY_CHECK_QUEUE_NAME, ok: true },
        { name: STALE_CHECKIN_SWEEP_QUEUE_NAME, ok: true },
      ],
    });
    expect(Worker).toHaveBeenCalledTimes(3);
    expect(mockStartWorkerHeartbeat).toHaveBeenCalledTimes(1);
    expect(mockStartWorkerHeartbeat).toHaveBeenCalledWith("job-runtime");
  });

  it("leaves runtimeStarted false when any pilot worker fails to start", async () => {
    let redisConnectAttempts = 0;
    vi.mocked(createRedisConnection).mockImplementation(async () => {
      redisConnectAttempts += 1;
      // getOrCreateQueue is mocked — attempt 1: charge-alert worker; 2: expiry-check worker
      if (redisConnectAttempts === 2) return null;
      return fakeRedisConnection() as Awaited<ReturnType<typeof createRedisConnection>>;
    });

    await startJobRuntime();

    expect(isJobRuntimeStarted()).toBe(false);
    expect(getRuntimeReadiness()).toEqual({
      started: false,
      workers: [
        { name: CHARGE_ALERT_QUEUE_NAME, ok: true },
        { name: EXPIRY_CHECK_QUEUE_NAME, ok: false },
        { name: STALE_CHECKIN_SWEEP_QUEUE_NAME, ok: true },
      ],
    });
    expect(Worker).toHaveBeenCalledTimes(2);
    expect(mockStartWorkerHeartbeat).not.toHaveBeenCalled();
  });
});
