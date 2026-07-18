import { describe, expect, it, vi } from "vitest";

import type { RfidRead } from "../src/adapter";
import { MovementAggregator, TokenBucket } from "../src/aggregate";
import { createStderrLogger } from "../src/logger";

function read(tagEpc: string, gatewayCode: string, ms: number): RfidRead {
  return { tagEpc, gatewayCode, readAt: new Date(ms) };
}

describe("MovementAggregator — one movement per crossing, floods coalesced", () => {
  it("collapses 1000 reads of a single crossing to <= 1 movement event", () => {
    const agg = new MovementAggregator();
    const base = 1_800_000_000_000;
    // E1 enters GW-2 once, then is re-read 999 more times at GW-2.
    for (let i = 0; i < 1000; i += 1) agg.ingest(read("E1", "GW-2", base + i * 10));
    const batches = agg.drainBatches();
    const total = batches.reduce((n, b) => n + b.length, 0);
    expect(total).toBeLessThanOrEqual(1);
    expect(total).toBe(1);
    expect(batches[0][0].gatewayCode).toBe("GW-2");
  });

  it("coalesces latest-per-tag within a flush window (server re-derives room changes)", () => {
    const agg = new MovementAggregator();
    const base = 1_800_000_000_000;
    agg.ingest(read("E1", "GW-1", base)); // entry
    agg.ingest(read("E1", "GW-2", base + 1_000)); // crossing
    agg.ingest(read("E1", "GW-3", base + 2_000)); // crossing again
    const batches = agg.drainBatches();
    expect(batches.reduce((n, b) => n + b.length, 0)).toBe(1);
    expect(batches[0][0].gatewayCode).toBe("GW-3"); // latest position wins
  });

  it("splits a flood of distinct tags into <=200-event batches, dropping NOTHING, and logs the flood", () => {
    const logs: string[] = [];
    const logger = createStderrLogger((c) => logs.push(c));
    const agg = new MovementAggregator({ maxEventsPerBatch: 200, logger });
    const base = 1_800_000_000_000;
    for (let i = 0; i < 500; i += 1) agg.ingest(read(`E${i}`, "GW-1", base + i));
    const batches = agg.drainBatches();
    expect(batches).toHaveLength(3); // 200 + 200 + 100
    expect(batches.every((b) => b.length <= 200)).toBe(true);
    expect(batches.reduce((n, b) => n + b.length, 0)).toBe(500); // nothing dropped
    expect(logs.some((l) => l.includes("flush_flood_split"))).toBe(true);
  });

  it("rejects a non-positive / out-of-range / non-integer maxEventsPerBatch", () => {
    // maxEventsPerBatch <= 0 would make drainBatches() non-terminating.
    expect(() => new MovementAggregator({ maxEventsPerBatch: 0 })).toThrow();
    expect(() => new MovementAggregator({ maxEventsPerBatch: -5 })).toThrow();
    // > 200 produces batches the canonical ingest rejects.
    expect(() => new MovementAggregator({ maxEventsPerBatch: 201 })).toThrow();
    expect(() => new MovementAggregator({ maxEventsPerBatch: 1.5 })).toThrow();
    expect(() => new MovementAggregator({ maxEventsPerBatch: Number.NaN })).toThrow();
  });

  it("draining clears the pending buffer", () => {
    const agg = new MovementAggregator();
    agg.ingest(read("E1", "GW-1", 1_000));
    expect(agg.drainBatches().reduce((n, b) => n + b.length, 0)).toBe(1);
    expect(agg.drainBatches()).toEqual([]);
  });
});

describe("TokenBucket — 120/min rate governor", () => {
  it("allows up to capacity, then denies until refill", () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 120, refillPerSec: 2, now: () => now });
    let allowed = 0;
    for (let i = 0; i < 121; i += 1) if (bucket.tryRemove()) allowed += 1;
    expect(allowed).toBe(120);
    expect(bucket.tryRemove()).toBe(false);
    now = 1_000; // 1s later → 2 tokens refill
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(false);
  });

  it("never exceeds capacity on refill", () => {
    let now = 0;
    const bucket = new TokenBucket({ capacity: 120, refillPerSec: 2, now: () => now });
    now = 10_000_000; // huge gap
    let allowed = 0;
    while (bucket.tryRemove()) allowed += 1;
    expect(allowed).toBe(120);
  });
});
