import { describe, expect, it } from "vitest";

import {
  RFID_HEADERS,
  RFID_LIMITS,
  SIGNATURE_PREFIX,
  formatSignature,
  validateRfidBatch,
} from "../src/contract";

function validBatch() {
  return {
    batchId: "batch-1",
    controllerVersion: "test/1.0.0",
    events: [{ tagEpc: "E280AABB", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06.123Z" }],
  };
}

describe("RFID contract constants", () => {
  it("exposes the canonical two-`t` brand-cased header names", () => {
    expect(RFID_HEADERS.clinic).toBe("X-VetTrack-Clinic");
    expect(RFID_HEADERS.signature).toBe("X-VetTrack-Signature");
    // Guard against the one-`t` regression that broke the live ingest.
    expect(RFID_HEADERS.clinic.toLowerCase()).toBe("x-vettrack-clinic");
    expect(RFID_HEADERS.signature.toLowerCase()).toBe("x-vettrack-signature");
  });

  it("pins the signature prefix and the ingest limits", () => {
    expect(SIGNATURE_PREFIX).toBe("sha256=");
    expect(RFID_LIMITS.maxEventsPerBatch).toBe(200);
    expect(RFID_LIMITS.maxRequestsPerMinute).toBe(120);
    expect(RFID_LIMITS.maxBodyBytes).toBe(512 * 1024);
  });

  it("formatSignature prepends the sha256= prefix to a hex digest", () => {
    expect(formatSignature("deadbeef")).toBe("sha256=deadbeef");
  });
});

describe("validateRfidBatch — happy path", () => {
  it("accepts a well-formed batch and returns the parsed value", () => {
    const res = validateRfidBatch(validBatch());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.batchId).toBe("batch-1");
      expect(res.value.events).toHaveLength(1);
    }
  });

  it("accepts a batch without the optional controllerVersion", () => {
    const b = validBatch();
    delete (b as Record<string, unknown>).controllerVersion;
    expect(validateRfidBatch(b).ok).toBe(true);
  });
});

describe("validateRfidBatch — rejects each boundary", () => {
  const cases: Array<[string, unknown]> = [
    ["non-object", 42],
    ["null", null],
    ["missing batchId", { events: validBatch().events }],
    ["empty batchId", { ...validBatch(), batchId: "" }],
    ["batchId > 64", { ...validBatch(), batchId: "x".repeat(65) }],
    ["controllerVersion > 32", { ...validBatch(), controllerVersion: "x".repeat(33) }],
    ["empty events", { ...validBatch(), events: [] }],
    ["events > 200", { ...validBatch(), events: new Array(201).fill(validBatch().events[0]) }],
    ["empty tagEpc", { ...validBatch(), events: [{ tagEpc: "", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06Z" }] }],
    ["tagEpc > 128", { ...validBatch(), events: [{ tagEpc: "x".repeat(129), gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06Z" }] }],
    ["empty gatewayCode", { ...validBatch(), events: [{ tagEpc: "E1", gatewayCode: "", readAt: "2026-07-17T18:18:06Z" }] }],
    ["gatewayCode > 64", { ...validBatch(), events: [{ tagEpc: "E1", gatewayCode: "x".repeat(65), readAt: "2026-07-17T18:18:06Z" }] }],
    ["readAt without Z (offset)", { ...validBatch(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06+00:00" }] }],
    ["readAt Date.toString style", { ...validBatch(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "Fri Jul 17 2026" }] }],
    ["readAt garbage", { ...validBatch(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "nope" }] }],
  ];

  for (const [label, input] of cases) {
    it(`rejects: ${label}`, () => {
      const res = validateRfidBatch(input);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.length).toBeGreaterThan(0);
    });
  }
});
