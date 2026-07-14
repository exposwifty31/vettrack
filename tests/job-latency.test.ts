/**
 * Bounded per-job-kind latency tracking (p50/p95/p99). Keyed by the closed
 * JobKind enum — no labels, no high cardinality (frozen telemetry doctrine).
 * Surfaced through the existing metrics snapshot, not a new route.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { JobKind } from "../server/jobs/registry.js";
import {
  recordJobLatency,
  withJobLatency,
  getJobLatencySnapshot,
  resetJobLatencyForTests,
} from "../server/lib/job-latency.js";

beforeEach(() => resetJobLatencyForTests());

describe("job-latency", () => {
  it("is empty before anything is recorded", () => {
    expect(getJobLatencySnapshot()).toEqual({});
  });

  it("computes p50/p95/p99/min/max (nearest-rank) for a known distribution", () => {
    for (let ms = 1; ms <= 10; ms++) recordJobLatency("check-plug", ms);
    const snap = getJobLatencySnapshot();
    expect(snap["check-plug"]).toEqual({
      count: 10,
      p50Ms: 5, // ceil(0.50*10)-1 = idx 4 → 5
      p95Ms: 10, // ceil(0.95*10)-1 = idx 9 → 10
      p99Ms: 10,
      minMs: 1,
      maxMs: 10,
    });
  });

  it("tracks each kind independently", () => {
    recordJobLatency("check-plug", 100);
    recordJobLatency("check-expiry", 5);
    const snap = getJobLatencySnapshot();
    expect(snap["check-plug"].maxMs).toBe(100);
    expect(snap["check-expiry"].maxMs).toBe(5);
    expect(Object.keys(snap).sort()).toEqual(["check-expiry", "check-plug"]);
  });

  it("is bounded: keeps exactly the most recent MAX_SAMPLES (200)", () => {
    for (let i = 0; i < 300; i++) recordJobLatency("check-plug", i);
    const snap = getJobLatencySnapshot();
    // 300 samples (0..299), cap 200 → retains exactly the last 200 (100..299).
    expect(snap["check-plug"].count).toBe(200);
    expect(snap["check-plug"].minMs).toBe(100);
    expect(snap["check-plug"].maxMs).toBe(299);
  });

  it("ignores an unknown (non-enum) kind — no high-cardinality leakage", () => {
    // Cast is intentional: it bypasses the compile-time union to exercise the
    // RUNTIME allowlist guard (the whole point of this test). Safe — the value
    // never leaves this assertion.
    recordJobLatency("totally-bogus" as JobKind, 42);
    expect(getJobLatencySnapshot()).toEqual({});
  });

  it("ignores non-finite or negative durations", () => {
    recordJobLatency("check-plug", Number.NaN);
    recordJobLatency("check-plug", -5);
    recordJobLatency("check-plug", Infinity);
    expect(getJobLatencySnapshot()).toEqual({});
  });

  it("resetJobLatencyForTests clears all samples", () => {
    recordJobLatency("check-plug", 10);
    resetJobLatencyForTests();
    expect(getJobLatencySnapshot()).toEqual({});
  });
});

describe("withJobLatency — records on success AND failure (finally)", () => {
  it("records a sample when the job body resolves", async () => {
    await withJobLatency("check-plug", async () => "ok");
    expect(getJobLatencySnapshot()["check-plug"].count).toBe(1);
  });

  it("records a sample even when the job body rejects, and re-throws the error", async () => {
    await expect(
      withJobLatency("check-expiry", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The whole point: the finally block records latency on the failure path too.
    expect(getJobLatencySnapshot()["check-expiry"].count).toBe(1);
  });

  it("returns the body's resolved value unchanged", async () => {
    expect(await withJobLatency("check-plug", async () => 42)).toBe(42);
  });
});

describe("runtime wiring", () => {
  // Behavior is proven above; this just guards that runPilotJob still routes
  // its dispatch through withJobLatency (the timing can't be silently dropped).
  const src = readFileSync(resolve(process.cwd(), "server/jobs/runtime.ts"), "utf-8");
  it("runPilotJob times the dispatch via withJobLatency(definition.kind)", () => {
    expect(src).toMatch(/withJobLatency\(\s*definition\.kind/);
  });
});
