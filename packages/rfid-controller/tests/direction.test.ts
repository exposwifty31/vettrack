import { describe, expect, it } from "vitest";

import type { RfidRead } from "../src/adapter";
import { DirectionTracker } from "../src/direction";

function read(tagEpc: string, gatewayCode: string, ms: number): RfidRead {
  return { tagEpc, gatewayCode, readAt: new Date(ms) };
}

describe("DirectionTracker — time/sequence-based movement inference (internal evidence)", () => {
  it("first sighting of a tag is a crossing INTO the gateway (fromGateway = null)", () => {
    const t = new DirectionTracker();
    const m = t.observe(read("E1", "GW-1", 1_000));
    expect(m.kind).toBe("moved");
    if (m.kind === "moved") {
      expect(m.fromGateway).toBeNull();
      expect(m.toGateway).toBe("GW-1");
      expect(m.gatewayCode).toBe("GW-1"); // wire-facing gateway = where the tag now is
    }
  });

  it("a repeat at the same gateway is classified 'same' (no crossing)", () => {
    const t = new DirectionTracker();
    t.observe(read("E1", "GW-1", 1_000));
    const m = t.observe(read("E1", "GW-1", 2_000));
    expect(m.kind).toBe("same");
  });

  it("a move to a new gateway records from→to (sequence-derived direction)", () => {
    const t = new DirectionTracker();
    t.observe(read("E1", "GW-1", 1_000));
    const m = t.observe(read("E1", "GW-2", 2_000));
    expect(m.kind).toBe("moved");
    if (m.kind === "moved") {
      expect(m.fromGateway).toBe("GW-1");
      expect(m.toGateway).toBe("GW-2");
    }
  });

  it("tracks gateways independently per tag", () => {
    const t = new DirectionTracker();
    t.observe(read("E1", "GW-1", 1_000));
    t.observe(read("E2", "GW-9", 1_000));
    expect(t.lastGateway("E1")).toBe("GW-1");
    expect(t.lastGateway("E2")).toBe("GW-9");
    expect(t.lastGateway("E3")).toBeNull();
  });

  it("bounds per-tag state — evicts the least-recently-observed tag beyond capacity", () => {
    const t = new DirectionTracker(2);
    t.observe(read("E1", "GW-1", 1));
    t.observe(read("E2", "GW-2", 2));
    t.observe(read("E3", "GW-3", 3)); // over capacity → evict oldest (E1)
    expect(t.lastGateway("E1")).toBeNull();
    expect(t.lastGateway("E2")).toBe("GW-2");
    expect(t.lastGateway("E3")).toBe("GW-3");
  });

  it("retains recently-active tags (re-observing a tag refreshes its recency)", () => {
    const t = new DirectionTracker(2);
    t.observe(read("E1", "GW-1", 1));
    t.observe(read("E2", "GW-2", 2));
    t.observe(read("E1", "GW-1", 3)); // touch E1 → E2 becomes least-recent
    t.observe(read("E3", "GW-3", 4)); // over capacity → evict E2, keep E1
    expect(t.lastGateway("E2")).toBeNull();
    expect(t.lastGateway("E1")).toBe("GW-1");
    expect(t.lastGateway("E3")).toBe("GW-3");
  });
});
