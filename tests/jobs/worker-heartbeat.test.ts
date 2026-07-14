/**
 * Regression guard for the leaked worker-heartbeat interval.
 *
 * `startWorkerHeartbeat` installs a module-singleton `setInterval`. Its only
 * cleanup used to be a private, never-exported `stopWorkerHeartbeatForTests`,
 * so once any test called `startJobRuntime` the interval ticked for the whole
 * suite — and its ticks hit redis mocks that omit `getRedis`, printing a scary
 * "[job-runtime] heartbeat tick failed Error" in otherwise-green CI. The stop
 * must be public and must actually clear the interval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRedisMock = vi.fn();
vi.mock("../../server/lib/redis.js", () => ({
  getRedis: (...args: unknown[]) => getRedisMock(...args),
}));

import { startWorkerHeartbeat, stopWorkerHeartbeat } from "../../server/lib/worker-heartbeat.js";

describe("worker-heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getRedisMock.mockReset().mockResolvedValue(null);
  });
  afterEach(() => {
    stopWorkerHeartbeat();
    vi.useRealTimers();
  });

  it("stops ticking after stopWorkerHeartbeat — no leaked interval", async () => {
    startWorkerHeartbeat("test");
    // The immediate tick calls getRedis synchronously (before its first await).
    expect(getRedisMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(30_000); // one interval tick
    const ticksBeforeStop = getRedisMock.mock.calls.length;
    expect(ticksBeforeStop).toBeGreaterThan(1);

    stopWorkerHeartbeat();
    await vi.advanceTimersByTimeAsync(120_000); // 4 intervals would have fired
    expect(getRedisMock.mock.calls.length).toBe(ticksBeforeStop); // none did
  });

  it("does not start a second interval when called twice (singleton guard)", async () => {
    startWorkerHeartbeat("test"); // immediate tick → 1 call
    startWorkerHeartbeat("test"); // guarded no-op — no second immediate, no second interval
    await vi.advanceTimersByTimeAsync(30_000); // exactly one interval tick → 2 total
    expect(getRedisMock.mock.calls.length).toBe(2);
  });
});
