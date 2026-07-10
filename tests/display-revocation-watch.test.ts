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
  maxConsecutiveErrors?: number,
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

  it("fails CLOSED after maxConsecutiveErrors consecutive errors (sustained outage)", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("db down");
    });
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000, 3);

    await vi.advanceTimersByTimeAsync(2000); // 2 errors — under the cap of 3
    expect(onRevoked).not.toHaveBeenCalled();
    expect(incrementMetric).not.toHaveBeenCalledWith("display_revocation_recheck_failclosed");

    await vi.advanceTimersByTimeAsync(1000); // 3rd consecutive error — hits the cap
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(incrementMetric).toHaveBeenCalledWith("display_revocation_recheck_failclosed");

    // Once failed-closed the watch is stopped — no further rechecks or callbacks.
    await vi.advanceTimersByTimeAsync(5000);
    expect(onRevoked).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a successful recheck resets the error streak (no premature fail-closed)", async () => {
    let mode: "throw" | "ok" = "throw";
    const resolve = vi.fn(async () => {
      if (mode === "throw") throw new Error("blip");
      return { ok: true };
    });
    const onRevoked = vi.fn();
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000, 3);

    await vi.advanceTimersByTimeAsync(2000); // 2 errors (streak = 2, under cap)
    mode = "ok";
    await vi.advanceTimersByTimeAsync(1000); // success → streak resets to 0
    mode = "throw";
    await vi.advanceTimersByTimeAsync(2000); // 2 more errors (streak = 2 again, under cap)

    expect(onRevoked).not.toHaveBeenCalled();
    expect(incrementMetric).not.toHaveBeenCalledWith("display_revocation_recheck_failclosed");
    stop();
  });

  it("skips overlapping rechecks while one is still in flight (inFlight guard)", async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    const pending = new Promise<{ ok: boolean }>((res) => {
      release = res;
    });
    const resolve = vi.fn(() => pending);
    const onRevoked = vi.fn();
    // Large timeout so the still-pending recheck is NOT force-settled during the window.
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000, 5, 1_000_000);

    await vi.advanceTimersByTimeAsync(3000); // three ticks fire; the first recheck is still pending
    expect(resolve).toHaveBeenCalledTimes(1); // overlap guard: exactly one in-flight recheck
    expect(onRevoked).not.toHaveBeenCalled();

    release({ ok: true }); // settle so nothing dangles
    await vi.advanceTimersByTimeAsync(0);
    stop();
  });

  it("times out a hung resolver into the error path (never pins inFlight forever)", async () => {
    const resolve = vi.fn(() => new Promise<{ ok: boolean }>(() => {})); // never settles
    const onRevoked = vi.fn();
    // timeout 500ms < interval 1000ms → a hung recheck is abandoned within its cycle.
    const stop = startDisplayRevocationWatch(displayReq, onRevoked, resolve, 1000, 5, 500);

    await vi.advanceTimersByTimeAsync(1600); // tick@1000 starts the recheck; timeout@1500 rejects it
    expect(incrementMetric).toHaveBeenCalledWith("display_revocation_recheck_error");
    expect(onRevoked).not.toHaveBeenCalled(); // a single timeout is under the fail-closed cap
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
