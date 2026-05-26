/**
 * Queue factory must not permanently block enqueue after a transient Redis failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bullmq", () => {
  const Queue = vi.fn(function QueueMock(this: { on: ReturnType<typeof vi.fn> }) {
    this.on = vi.fn();
  });
  return { Queue };
});

vi.mock("../../server/lib/redis.js", () => ({
  getRedisUrl: vi.fn(),
  createRedisConnection: vi.fn(),
}));

import { Queue } from "bullmq";
import { createRedisConnection, getRedisUrl } from "../../server/lib/redis.js";
import {
  getOrCreateQueue,
  resetQueueFactoryForTests,
} from "../../server/jobs/queue-factory.js";

describe("queue-factory Redis recovery", () => {
  beforeEach(() => {
    resetQueueFactoryForTests();
    vi.clearAllMocks();
    vi.mocked(getRedisUrl).mockReturnValue("redis://localhost:6379");
  });

  afterEach(() => {
    resetQueueFactoryForTests();
  });

  it("retries createRedisConnection on later calls after a transient failure", async () => {
    vi.mocked(createRedisConnection)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ quit: vi.fn() } as Awaited<ReturnType<typeof createRedisConnection>>);

    await expect(
      getOrCreateQueue({ queueName: "inventory-deduction" }),
    ).rejects.toThrow(/Redis connection failed/);

    await expect(getOrCreateQueue({ queueName: "inventory-deduction" })).resolves.toBeDefined();
    expect(createRedisConnection).toHaveBeenCalledTimes(2);
    expect(Queue).toHaveBeenCalledTimes(1);
  });
});
