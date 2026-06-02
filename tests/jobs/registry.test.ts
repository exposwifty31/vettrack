import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "job-1" } as Job),
}));

vi.mock("bullmq", () => {
  function QueueMock(this: { add: typeof mockQueueAdd; on: ReturnType<typeof vi.fn> }) {
    this.add = mockQueueAdd;
    this.on = vi.fn();
  }
  return { Queue: QueueMock };
});

vi.mock("../../server/lib/redis.js", () => ({
  createRedisConnection: vi.fn().mockResolvedValue({ on: vi.fn() }),
  getRedisUrl: vi.fn().mockReturnValue("redis://127.0.0.1:6379"),
}));

import {
  assertJobRegistryConsistency,
  buildStaleTaskOwnershipSweepJobId,
  definitionByKind,
  definitionsByQueue,
  integrationBullmqJobName,
  staticJobDefinitions,
  STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME,
} from "../../server/jobs/definitions/index.js";
import { enqueueJob, enqueueIntegrationSyncJob } from "../../server/jobs/enqueue.js";
import { resetQueueFactoryForTests } from "../../server/jobs/queue-factory.js";
import { mergeEnqueueJobOptions } from "../../server/jobs/registry.js";

describe("job registry consistency", () => {
  it("passes internal consistency checks", () => {
    expect(() => assertJobRegistryConsistency()).not.toThrow();
  });

  it("maps each static kind exactly once", () => {
    expect(definitionByKind.size).toBe(staticJobDefinitions.length);
    for (const def of staticJobDefinitions) {
      expect(definitionByKind.get(def.kind as keyof typeof definitionByKind)).toBe(def);
    }
  });

  it("indexes definitions only by JobDefinition.queue", () => {
    const queuesFromDefs = new Set(staticJobDefinitions.map((d) => d.queue));
    expect(definitionsByQueue.size).toBe(queuesFromDefs.size);
    for (const queueName of queuesFromDefs) {
      const defs = definitionsByQueue.get(queueName);
      expect(defs?.length).toBeGreaterThan(0);
      expect(defs?.every((d) => d.queue === queueName)).toBe(true);
    }
  });

  it("uses existing BullMQ job names for static kinds", () => {
    expect(definitionByKind.has("inventory-deduction")).toBe(true);
    expect(definitionByKind.has("check-plug")).toBe(true);
    expect(definitionByKind.has("stale-task-ownership-sweep")).toBe(true);
    expect(definitionByKind.has("check-expiry")).toBe(true);
    expect(definitionByKind.has("sweep-stale-checkins")).toBe(true);
  });
});

describe("integration job naming", () => {
  it("builds legacy adapter:syncType:direction job names", () => {
    expect(
      integrationBullmqJobName({
        clinicId: "c1",
        adapterId: "idexx",
        syncType: "patients",
        direction: "inbound",
      }),
    ).toBe("idexx:patients:inbound");
  });
});

describe("stale ownership sweep jobId", () => {
  it("matches queue wrapper bucket format", () => {
    const nowMs = 120_000;
    expect(buildStaleTaskOwnershipSweepJobId("clinic-a", nowMs)).toBe(
      `${STALE_TASK_OWNERSHIP_SWEEP_QUEUE_NAME}:clinic-a:2`,
    );
  });
});

describe("enqueueJob option passthrough", () => {
  beforeEach(() => {
    resetQueueFactoryForTests();
    mockQueueAdd.mockClear();
  });

  it("merges definition defaults with bullmq overrides", async () => {
    const def = definitionByKind.get("inventory-deduction")!;
    const merged = mergeEnqueueJobOptions(def, { attempts: 9 });
    expect(merged.attempts).toBe(9);
    expect(merged.backoff).toEqual({ type: "exponential", delay: 5000 });
    expect(merged.removeOnComplete).toBe(1000);
    expect(merged.removeOnFail).toBe(5000);
  });

  it("passes jobId and delayMs to queue.add for check-plug", async () => {
    await enqueueJob(
      "check-plug",
      { returnId: "r1", equipmentId: "e1", clinicId: "c1" },
      { jobId: "plug-check-r1", delayMs: 60_000, bullmq: { removeOnFail: 100 } },
    );

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "check-plug",
      { returnId: "r1", equipmentId: "e1", clinicId: "c1" },
      expect.objectContaining({
        jobId: "plug-check-r1",
        delay: 60_000,
        removeOnComplete: 50,
        removeOnFail: 100,
      }),
    );
  });

  it("applies time-bucket jobId for stale-task-ownership-sweep", async () => {
    const now = 1_800_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    await enqueueJob("stale-task-ownership-sweep", {
      clinicId: "c1",
      requestedByUserId: "u1",
      limit: null,
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "stale-task-ownership-sweep",
      expect.objectContaining({ clinicId: "c1" }),
      expect.objectContaining({
        jobId: buildStaleTaskOwnershipSweepJobId("c1", now),
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
      }),
    );

    vi.mocked(Date.now).mockRestore();
  });
});

describe("enqueueIntegrationSyncJob", () => {
  beforeEach(() => {
    resetQueueFactoryForTests();
    mockQueueAdd.mockClear();
  });

  it("uses dynamic job name and default jobId", async () => {
    await enqueueIntegrationSyncJob({
      clinicId: "clinic-1",
      adapterId: "vetspire",
      syncType: "billing",
      direction: "outbound",
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "vetspire:billing:outbound",
      expect.objectContaining({ clinicId: "clinic-1" }),
      expect.objectContaining({
        jobId: "clinic-1:vetspire:billing:outbound",
        attempts: 3,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: 500,
        removeOnFail: 2000,
      }),
    );
  });
});
