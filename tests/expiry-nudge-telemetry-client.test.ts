/**
 * T-30a2-ii — client-side nudge telemetry classifier. Mirrors T-30a2-i's
 * server-side closed enum (nudgeShown: "expiry" | "restock"): the client
 * classifier only ever resolves an in-enum bucket, and the post helper
 * never emits telemetry for an out-of-enum kind.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { telemetry } = vi.hoisted(() => ({
  telemetry: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/lib/api", () => ({ api: { realtime: { telemetry } } }));

import { classifyNudgeShown, reportNudgeShown } from "@/lib/realtime";

describe("T-30a2-ii nudge telemetry client classifier", () => {
  beforeEach(() => {
    telemetry.mockClear();
  });

  it("classifies 'expiry' to itself", () => {
    expect(classifyNudgeShown("expiry")).toBe("expiry");
  });

  it("classifies 'restock' to itself", () => {
    expect(classifyNudgeShown("restock")).toBe("restock");
  });

  it("classifies any other kind to null", () => {
    expect(classifyNudgeShown("bogus")).toBeNull();
    expect(classifyNudgeShown("")).toBeNull();
    expect(classifyNudgeShown("Expiry")).toBeNull();
  });

  it("posts nudgeShown: 'expiry' for an expiry nudge", () => {
    reportNudgeShown("expiry");
    expect(telemetry).toHaveBeenCalledWith({ nudgeShown: "expiry" });
  });

  it("posts nudgeShown: 'restock' for a restock nudge", () => {
    reportNudgeShown("restock");
    expect(telemetry).toHaveBeenCalledWith({ nudgeShown: "restock" });
  });

  it("never posts for an out-of-enum kind", () => {
    reportNudgeShown("bogus");
    expect(telemetry).not.toHaveBeenCalled();
  });
});
