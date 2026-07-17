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

describe("route + limiter derive the SAME clinicId (no header-spelling drift)", () => {
  it("the limiter key's clinic segment equals the route's readRfidClinicId", () => {
    const req = fakeReq({ "x-vettrack-clinic": "clinic-a" }, "198.51.100.9");
    // Route path: the MISSING_CLINIC gate + downstream keying use readRfidClinicId.
    const routeClinicId = readRfidClinicId(req);
    // Limiter path: rfidEventLimiterKey is `${clinicId}:${ip}`.
    const limiterKey = rfidEventLimiterKey(req);
    expect(routeClinicId).toBe("clinic-a");
    expect(limiterKey).toBe(`${routeClinicId}:198.51.100.9`);
  });

  it("both paths agree the one-`t` spelling is NOT clinic-scoped", () => {
    const req = fakeReq({ "x-vetrack-clinic": "clinic-a" }, "198.51.100.9");
    const routeClinicId = readRfidClinicId(req);
    const limiterKey = rfidEventLimiterKey(req);
    expect(routeClinicId).toBe("");
    // Empty clinic segment → per-IP tail, identical for both consumers.
    expect(limiterKey).toBe(`:198.51.100.9`);
  });
});
