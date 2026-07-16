/**
 * R-RTC-1.3 — server-enforced board rate limits + payload validation.
 */
import { describe, it, expect } from "vitest";
import { createRateLimiter, isNormalizedCoord, isWithinByteLimit } from "../server/lib/realtime-collab/rate-limit.js";

describe("board rate limiter — R-RTC-1.3", () => {
  it("drops cursor events beyond 20/s within a fixed 1s window", () => {
    let t = 0;
    const rl = createRateLimiter(() => t);
    const results: string[] = [];
    for (let i = 0; i < 25; i++) results.push(rl.check("cur:s1", 20));
    const allowed = results.filter((r) => r === "allow").length;
    const dropped = results.filter((r) => r === "drop").length;
    expect(allowed).toBe(20);
    expect(dropped).toBe(5); // 21st..25th dropped (not relayed)
  });

  it("resets the budget in the next 1s window", () => {
    let t = 0;
    const rl = createRateLimiter(() => t);
    for (let i = 0; i < 20; i++) rl.check("cur:s1", 20);
    expect(rl.check("cur:s1", 20)).toBe("drop");
    t += 1_000; // new window
    expect(rl.check("cur:s1", 20)).toBe("allow");
  });

  it("signals disconnect on a burst beyond 5× the budget", () => {
    let t = 0;
    const rl = createRateLimiter(() => t);
    let sawDisconnect = false;
    for (let i = 0; i < 101; i++) {
      if (rl.check("cur:s1", 20) === "disconnect") sawDisconnect = true;
    }
    expect(sawDisconnect).toBe(true); // >100 (20×5) in one window
  });

  it("reset() clears a socket's counters (no unbounded growth)", () => {
    const rl = createRateLimiter(() => 0);
    rl.check("cur:s1", 20);
    rl.reset("cur:s1");
    // After reset the next check starts a fresh window.
    expect(rl.check("cur:s1", 20)).toBe("allow");
  });

  it("validates normalized cursor coordinates ([0,1] finite)", () => {
    expect(isNormalizedCoord(0)).toBe(true);
    expect(isNormalizedCoord(0.5)).toBe(true);
    expect(isNormalizedCoord(1)).toBe(true);
    expect(isNormalizedCoord(-0.1)).toBe(false);
    expect(isNormalizedCoord(1.1)).toBe(false);
    expect(isNormalizedCoord(NaN)).toBe(false);
    expect(isNormalizedCoord(Infinity)).toBe(false);
    expect(isNormalizedCoord("0.5")).toBe(false);
  });

  it("rejects oversized payloads (> 2 KB)", () => {
    expect(isWithinByteLimit({ x: 0.1, y: 0.2 }, 2_048)).toBe(true);
    expect(isWithinByteLimit({ blob: "x".repeat(3_000) }, 2_048)).toBe(false);
  });
});
