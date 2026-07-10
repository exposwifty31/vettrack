// Phase 10 (F6) — live-stream revocation lifecycle. Round-2 CodeRabbit asked for
// coverage BEYOND the resolveDisplayAuth predicate (display-token-deny-list): the
// actual periodic re-check must (a) close the stream when the token is revoked and
// (b) keep the stream open + bump a bounded counter on a transient resolver error.
// The /stream handler's revocation watch is extracted into `startDisplayRevocationWatch`
// (injectable resolver + interval, self-gated on req.isDisplayAuth) precisely so it
// can be exercised with fake timers without mounting the full SSE route (db / outbox
// / keepalive / subscribe).

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

// The watch only reads req.isDisplayAuth; a minimal cast is enough (the real handler
// passes the full Express Request).
const displayReq = { headers: {}, isDisplayAuth: true } as unknown as Request;
const userReq = { headers: {}, isDisplayAuth: false } as unknown as Request;

beforeEach(() => {
  incrementMetric.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startDisplayRevocationWatch (F6 live-stream revocation lifecycle)", () => {
  it("keeps the stream open while the token stays active", async () => {
    const resolve = vi.fn(async () => ({ ok: true }));
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(onRevoked).not.toHaveBeenCalled();
    stop();
  });

  it("closes the stream once the token is revoked", async () => {
    let active = true;
    const resolve = vi.fn(async () => ({ ok: active }));
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000);

    await vi.advanceTimersByTimeAsync(1000); // still active
    expect(onRevoked).not.toHaveBeenCalled();
    active = false; // revoked
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRevoked).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stop() suppresses any further rechecks and callbacks", async () => {
    const resolve = vi.fn(async () => ({ ok: false }));
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000);
    stop(); // torn down before the first tick
    await vi.advanceTimersByTimeAsync(5000);
    expect(resolve).not.toHaveBeenCalled();
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it("keeps the stream open and increments the bounded counter on a transient resolver error", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("db down");
    });
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onRevoked).not.toHaveBeenCalled(); // a blip must never tear down a live board
    expect(incrementMetric).toHaveBeenCalledWith("display_revocation_recheck_error");
    stop();
  });

  it("does NOT watch a user (non-display) connection — the /stream gate lives in the function", async () => {
    const resolve = vi.fn(async () => ({ ok: true }));
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(userReq, onRevoked, resolve, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(resolve).not.toHaveBeenCalled();
    expect(onRevoked).not.toHaveBeenCalled();
    stop(); // no-op stop is safe to call
  });
});
