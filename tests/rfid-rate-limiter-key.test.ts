import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { rfidEventLimiterKey } from "../server/middleware/rate-limiters.js";

function fakeReq(headers: Record<string, string | string[] | undefined>, ip = "203.0.113.7"): Request {
  return { headers, ip } as unknown as Request;
}

describe("rfidEventLimiterKey — per-clinic keying (canonical two-`t` header)", () => {
  it("keys per-clinic from the canonical x-vettrack-clinic (two-`t`) header", () => {
    const key = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-a" }));
    // Clinic segment MUST be present so two clinics behind one IP get
    // independent 120/min buckets (the bug: one-`t` read → empty clinic → per-IP).
    expect(key.startsWith("clinic-a:")).toBe(true);
    expect(key).not.toBe(":203.0.113.7");
  });

  it("gives two clinics behind one IP distinct keys", () => {
    const a = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-a" }, "198.51.100.9"));
    const b = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-b" }, "198.51.100.9"));
    expect(a).not.toBe(b);
  });

  it("does NOT read the buggy one-`t` x-vetrack-clinic spelling", () => {
    // A request that only carries the old one-`t` spelling must NOT be treated
    // as clinic-scoped — proves the limiter no longer silently reads one-`t`.
    const key = rfidEventLimiterKey(fakeReq({ "x-vetrack-clinic": "clinic-a" }));
    expect(key.startsWith("clinic-a:")).toBe(false);
  });

  it("trims and tolerates array-valued headers", () => {
    const key = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": ["  clinic-c  "] }));
    expect(key.startsWith("clinic-c:")).toBe(true);
  });
});
