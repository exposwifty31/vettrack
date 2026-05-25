/**
 * F1b-1 — bounded server counters for job registry / idempotency events.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type { Job } from "bullmq";
import {
  getMetricsSnapshot,
  incrementMetric,
  resetMetrics,
} from "../server/lib/metrics.js";
import {
  EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS,
  hashEquipmentReplayRequest,
} from "../server/lib/equipment-replay-idempotency.js";

const F1_COUNTERS = [
  "replay_idempotency_collision",
  "job_runtime_unknown_job_name",
  "legacy_worker_starter_used",
  "job_runtime_worker_unavailable",
  "job_enqueue_queue_unavailable",
] as const;

describe("F1b-1 server metrics — bounded counters", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("exposes all F1b/F2c jobRegistry counters at zero in getMetricsSnapshot()", () => {
    const snap = getMetricsSnapshot();
    expect(snap.jobRegistry).toEqual({
      replayIdempotencyCollision: 0,
      jobRuntimeUnknownJobName: 0,
      legacyWorkerStarterUsed: 0,
      jobRuntimeWorkerUnavailable: 0,
      jobEnqueueQueueUnavailable: 0,
    });
  });

  it.each(F1_COUNTERS)("incrementMetric('%s') maps into jobRegistry snapshot", (name) => {
    incrementMetric(name, 1);
    const snap = getMetricsSnapshot();
    switch (name) {
      case "replay_idempotency_collision":
        expect(snap.jobRegistry.replayIdempotencyCollision).toBe(1);
        break;
      case "job_runtime_unknown_job_name":
        expect(snap.jobRegistry.jobRuntimeUnknownJobName).toBe(1);
        break;
      case "legacy_worker_starter_used":
        expect(snap.jobRegistry.legacyWorkerStarterUsed).toBe(1);
        break;
      case "job_runtime_worker_unavailable":
        expect(snap.jobRegistry.jobRuntimeWorkerUnavailable).toBe(1);
        break;
      case "job_enqueue_queue_unavailable":
        expect(snap.jobRegistry.jobEnqueueQueueUnavailable).toBe(1);
        break;
      default:
        throw new Error(`unhandled counter: ${name}`);
    }
  });

  it("silently drops unknown metric names (no dynamic series)", () => {
    incrementMetric("f1_user_id_alice", 99);
    incrementMetric("job_runtime_unknown_job_name_extra_label", 99);
    const snap = getMetricsSnapshot();
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("f1_user_id_alice");
    expect(serialized).not.toContain("alice");
    expect(snap.jobRegistry.jobRuntimeUnknownJobName).toBe(0);
  });

  it("incrementMetric accepts only name and numeric value (no label args)", () => {
    expect(incrementMetric.length).toBeLessThanOrEqual(2);
    incrementMetric("replay_idempotency_collision");
    expect(getMetricsSnapshot().jobRegistry.replayIdempotencyCollision).toBe(1);
  });
});

const selectLimitMock = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(),
      })),
    })),
  },
  idempotencyKeys: {},
}));

const { equipmentReplayIdempotency } = await import(
  "../server/middleware/equipment-replay-idempotency.js"
);

const ROUTE = EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.scan;
const PATH = "/api/equipment/eq-1/scan";

function makeRes(): { res: Response; statusCode: number } {
  let statusCode = 200;
  const res = {
    get statusCode() {
      return statusCode;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json() {
      return this;
    },
    send() {
      return this;
    },
  } as unknown as Response;
  return { res, get statusCode() { return statusCode; } };
}

function makeReq(body: unknown): Request {
  return {
    method: "POST",
    originalUrl: PATH,
    url: PATH,
    body,
    headers: { "idempotency-key": "key-1" },
    clinicId: "clinic-1",
    authUser: { id: "user-1", email: "u@test.local", role: "technician" },
  } as unknown as Request;
}

describe("F1b-1 — replay_idempotency_collision counter", () => {
  beforeEach(() => {
    resetMetrics();
    selectLimitMock.mockReset();
  });

  it("increments on body-mismatch collision only", async () => {
    const firstBody = { status: "ok", note: "alpha" };
    const secondBody = { status: "ok", note: "beta" };
    const firstHash = hashEquipmentReplayRequest("POST", PATH, firstBody);

    selectLimitMock.mockResolvedValue([
      {
        requestHash: firstHash,
        statusCode: 200,
        responseBody: { equipment: { id: "eq-1" } },
      },
    ]);

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq(secondBody), makeRes().res, vi.fn());

    expect(getMetricsSnapshot().jobRegistry.replayIdempotencyCollision).toBe(1);
  });

  it("does not increment on cache hit with matching hash", async () => {
    const body = { status: "ok", note: "same" };
    const requestHash = hashEquipmentReplayRequest("POST", PATH, body);

    selectLimitMock.mockResolvedValue([
      { requestHash, statusCode: 200, responseBody: { equipment: { id: "eq-1" } } },
    ]);

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq(body), makeRes().res, vi.fn());

    expect(getMetricsSnapshot().jobRegistry.replayIdempotencyCollision).toBe(0);
  });
});

const mockWorkerOn = vi.fn();
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);
const mockConnectionQuit = vi.fn().mockResolvedValue(undefined);

const { mockWorkerCtor, mockQueueCtor, mockProcessInventory, mockBindQueue } = vi.hoisted(() => ({
  mockWorkerCtor: vi.fn(),
  mockQueueCtor: vi.fn(),
  mockProcessInventory: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn(),
  getRedisUrl: vi.fn().mockReturnValue("redis://127.0.0.1:6379"),
}));

vi.mock("../server/workers/inventory-deduction.worker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/workers/inventory-deduction.worker.js")>();
  return {
    ...actual,
    processInventoryDeductionJob: mockProcessInventory,
  };
});

vi.mock("../server/workers/chargeAlertWorker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/workers/chargeAlertWorker.js")>();
  return {
    ...actual,
    processChargeAlertJob: vi.fn().mockResolvedValue(undefined),
    bindChargeAlertProducerQueue: mockBindQueue,
  };
});

import { createRedisConnection } from "../server/lib/redis.js";
import {
  closeJobRuntime,
  resetJobRuntimeStateForTests,
  startJobRuntime,
} from "../server/jobs/runtime.js";
import { resetQueueFactoryForTests } from "../server/jobs/queue-factory.js";
import { INVENTORY_DEDUCTION_QUEUE_NAME } from "../server/queues/inventory-deduction.queue.js";

function mockRedisConnection() {
  return { quit: mockConnectionQuit, on: vi.fn() };
}

describe("F1b-1 — job_runtime_unknown_job_name counter", () => {
  beforeEach(() => {
    resetMetrics();
    resetJobRuntimeStateForTests();
    resetQueueFactoryForTests();
    mockWorkerCtor.mockClear();
    vi.mocked(createRedisConnection).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("increments when pilot worker processes unknown job.name", async () => {
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
    ).rejects.toThrow(/No JobDefinition/);

    expect(getMetricsSnapshot().jobRegistry.jobRuntimeUnknownJobName).toBe(1);
  });
});

describe("F1b-1 — job_runtime_worker_unavailable counter", () => {
  beforeEach(() => {
    resetMetrics();
    resetJobRuntimeStateForTests();
    resetQueueFactoryForTests();
    mockWorkerCtor.mockClear();
    vi.mocked(createRedisConnection).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("increments once per pilot queue when Redis is unavailable", async () => {
    vi.mocked(createRedisConnection).mockResolvedValue(null);

    await startJobRuntime();

    expect(getMetricsSnapshot().jobRegistry.jobRuntimeWorkerUnavailable).toBe(2);
    expect(mockWorkerCtor).not.toHaveBeenCalled();
  });
});

describe("F1b-1 — legacy_worker_starter_used counter", () => {
  beforeEach(() => {
    resetMetrics();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("increments once for startChargeAlertWorker and not on repeat", async () => {
    const incSpy = vi.spyOn(
      await import("../server/lib/metrics.js"),
      "incrementMetric",
    );

    vi.doMock("../server/lib/redis.js", () => ({
      createRedisConnection: vi.fn().mockResolvedValue(null),
    }));
    const { startChargeAlertWorker } = await import("../server/workers/chargeAlertWorker.js");
    await startChargeAlertWorker();
    await startChargeAlertWorker();

    expect(incSpy).toHaveBeenCalledWith("legacy_worker_starter_used");
    expect(
      incSpy.mock.calls.filter((c) => c[0] === "legacy_worker_starter_used"),
    ).toHaveLength(1);
    expect(getMetricsSnapshot().jobRegistry.legacyWorkerStarterUsed).toBe(1);
    incSpy.mockRestore();
  });

  it("increments when startInventoryDeductionWorker is first called", async () => {
    const incSpy = vi.spyOn(
      await import("../server/lib/metrics.js"),
      "incrementMetric",
    );

    vi.doMock("../server/lib/redis.js", () => ({
      createRedisConnection: vi.fn().mockResolvedValue(null),
    }));
    const { startInventoryDeductionWorker } = await import(
      "../server/workers/inventory-deduction.worker.js"
    );
    await startInventoryDeductionWorker();

    expect(incSpy).toHaveBeenCalledWith("legacy_worker_starter_used");
    expect(getMetricsSnapshot().jobRegistry.legacyWorkerStarterUsed).toBe(1);
    incSpy.mockRestore();
  });
});
