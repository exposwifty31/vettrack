import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { rfidEventLimiterKey } from "../server/middleware/rate-limiters.js";

function fakeReq(headers: Record<string, string | string[] | undefined>, ip = "203.0.113.7"): Request {
  return { headers, ip } as unknown as Request;
}

describe("rfidEventLimiterKey — IP-only pre-authentication keying", () => {
  it("keys solely by IP — the attacker-controlled clinic header never enters the key", () => {
    // This limiter runs BEFORE HMAC verification and is the only pre-auth backstop on the
    // ingest route. Keying by the unverified x-vettrack-clinic header would let one IP mint an
    // unbounded number of buckets by varying the header, defeating the 120/min DoS backstop.
    const key = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-a" }));
    expect(key).not.toContain("clinic-a");
    expect(key).toBe("ip:203.0.113.7");
  });

  it("gives two DIFFERENT clinic headers behind one IP the SAME key (no header-driven bypass)", () => {
    const a = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-a" }, "198.51.100.9"));
    const b = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-b" }, "198.51.100.9"));
    expect(a).toBe(b);
  });

  it("gives two distinct IPs distinct keys", () => {
    const a = rfidEventLimiterKey(fakeReq({}, "198.51.100.9"));
    const b = rfidEventLimiterKey(fakeReq({}, "203.0.113.7"));
    expect(a).not.toBe(b);
  });
});
