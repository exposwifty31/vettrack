// Phase 10 (F6) — live-stream revocation lifecycle. Round-2 CodeRabbit asked for
// coverage BEYOND the resolveDisplayAuth predicate (display-token-deny-list): the
// actual periodic re-check must (a) close the stream when the token is revoked and
// (b) keep the stream open + bump a bounded counter on a transient resolver error.
// The /stream handler's revocation watch is extracted into `startDisplayRevocationWatch`
// (injectable resolver + interval) precisely so it can be exercised with fake timers
// without mounting the full SSE route (db / outbox / keepalive / subscribe).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import type { Request } from "express";

const incrementMetric = vi.fn();
vi.mock("../server/lib/metrics.js", () => ({
  incrementMetric: (...a: unknown[]) => incrementMetric(...a),
}));

let startDisplayRevocationWatch: (
  req: Request,
  onRevoked: () => void,
  resolveDisplay?: (r: Request) => Promise<{ ok: boolean }>,
  intervalMs?: number,
) => () => void;

beforeAll(async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/vettrack_test";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  ({ startDisplayRevocationWatch } = await import("../server/routes/realtime.js"));
}, 30000);

const req = { headers: {} } as unknown as Request;

beforeEach(() => {
  incrementMetric.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startDisplayRevocationWatch (F6 live-stream revocation lifecycle)", () => {
  it("keeps the stream open while active, closes it on revocation, and stops on teardown", async () => {
    let active = true;
    const resolve = vi.fn(async () => ({ ok: active }));
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(req, onRevoked, resolve, 1000);

    // Tick 1: token still active → the stream stays open.
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onRevoked).not.toHaveBeenCalled();

    // Tick 2: token revoked → the stream is finalized exactly once.
    active = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRevoked).toHaveBeenCalledTimes(1);

    // Teardown halts further rechecks.
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("keeps the stream open and increments the bounded counter on a transient resolver error", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("db down");
    });
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(req, onRevoked, resolve, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    // A transient error must NEVER tear down a live board…
    expect(onRevoked).not.toHaveBeenCalled();
    // …but it IS surfaced via the bounded counter so a stuck recheck is visible.
    expect(incrementMetric).toHaveBeenCalledWith("display_revocation_recheck_error");

    stop();
  });
});
