import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { readRfidClinicId } from "../server/lib/rfid/clinic-header.js";
import { rfidEventLimiterKey } from "../server/middleware/rate-limiters.js";

function fakeReq(
  headers: Record<string, string | string[] | undefined>,
  ip = "203.0.113.7",
): Request {
  return { headers, ip } as unknown as Request;
}

describe("readRfidClinicId — shared canonical x-vettrack-clinic parse", () => {
  it("reads the canonical two-`t` header and trims it", () => {
    expect(readRfidClinicId(fakeReq({ "x-vettrack-clinic": "  clinic-a  " }))).toBe("clinic-a");
  });

  it("returns '' for the buggy one-`t` x-vetrack-clinic spelling", () => {
    expect(readRfidClinicId(fakeReq({ "x-vetrack-clinic": "clinic-a" }))).toBe("");
  });

  it("returns '' when the header is absent (route → MISSING_CLINIC 400)", () => {
    expect(readRfidClinicId(fakeReq({}))).toBe("");
  });

  it("tolerates array-valued headers", () => {
    expect(readRfidClinicId(fakeReq({ "x-vettrack-clinic": ["  clinic-c  "] }))).toBe("clinic-c");
  });

  it("returns '' for an empty array-valued header", () => {
    expect(readRfidClinicId(fakeReq({ "x-vettrack-clinic": [] }))).toBe("");
  });
});

describe("pre-auth limiter is decoupled from the attacker-controlled clinic header", () => {
  it("the route reads the clinic header, but the pre-auth limiter key is IP-only", () => {
    const req = fakeReq({ "x-vettrack-clinic": "clinic-a" }, "198.51.100.9");
    // Route path: the MISSING_CLINIC gate + downstream keying use readRfidClinicId.
    const routeClinicId = readRfidClinicId(req);
    // Limiter path runs BEFORE HMAC verification, so it must NOT trust the clinic header —
    // keying by it would let one IP mint unbounded buckets by varying the header.
    const limiterKey = rfidEventLimiterKey(req);
    expect(routeClinicId).toBe("clinic-a");
    expect(limiterKey).toBe("ip:198.51.100.9");
    expect(limiterKey).not.toContain(routeClinicId);
  });

  it("varying the clinic header from one IP cannot escape the per-IP bucket", () => {
    const ip = "198.51.100.9";
    const a = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-a" }, ip));
    const b = rfidEventLimiterKey(fakeReq({ "x-vettrack-clinic": "clinic-b" }, ip));
    const none = rfidEventLimiterKey(fakeReq({}, ip));
    expect(a).toBe(b);
    expect(a).toBe(none);
  });
});
