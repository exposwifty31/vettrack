import { describe, expect, it } from "vitest";

import type { RfidRead } from "../src/adapter";
import { ReadDebouncer } from "../src/debounce";

function read(tagEpc: string, gatewayCode: string, ms: number): RfidRead {
  return { tagEpc, gatewayCode, readAt: new Date(ms) };
}

describe("ReadDebouncer", () => {
  it("collapses a burst of repeat reads (same tag+gateway, within window) to ONE presence", () => {
    const d = new ReadDebouncer({ windowMs: 5_000 });
    const base = 1_800_000_000_000;
    const accepted: RfidRead[] = [];
    for (let i = 0; i < 50; i += 1) {
      const r = d.accept(read("E1", "GW-1", base + i * 50)); // 50ms apart, all inside 5s
      if (r) accepted.push(r);
    }
    expect(accepted).toHaveLength(1);
    expect(accepted[0].tagEpc).toBe("E1");
  });

  it("re-accepts the same tag+gateway once the window has elapsed (left and returned)", () => {
    const d = new ReadDebouncer({ windowMs: 5_000 });
    const base = 1_800_000_000_000;
    expect(d.accept(read("E1", "GW-1", base))).not.toBeNull();
    expect(d.accept(read("E1", "GW-1", base + 1_000))).toBeNull(); // within window
    expect(d.accept(read("E1", "GW-1", base + 6_000))).not.toBeNull(); // window elapsed
  });

  it("keys independently per gateway (same tag at a different gateway is a new presence)", () => {
    const d = new ReadDebouncer({ windowMs: 5_000 });
    const base = 1_800_000_000_000;
    expect(d.accept(read("E1", "GW-1", base))).not.toBeNull();
    expect(d.accept(read("E1", "GW-2", base + 100))).not.toBeNull();
  });

  it("keys independently per tag", () => {
    const d = new ReadDebouncer({ windowMs: 5_000 });
    const base = 1_800_000_000_000;
    expect(d.accept(read("E1", "GW-1", base))).not.toBeNull();
    expect(d.accept(read("E2", "GW-1", base + 100))).not.toBeNull();
  });
});
