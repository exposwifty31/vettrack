import { describe, expect, it } from "vitest";

import type { MovementEvent } from "../src/aggregate";
import { validateRfidBatch } from "../src/contract";
import { buildEnvelope } from "../src/envelope";

function mv(tagEpc: string, gatewayCode: string, iso: string, from: string | null = null): MovementEvent {
  return { tagEpc, gatewayCode, readAt: new Date(iso), fromGateway: from };
}

describe("buildEnvelope", () => {
  it("produces a batch that passes the canonical contract validator", () => {
    const { batch, body } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.123Z", "GW-1")]);
    const res = validateRfidBatch(batch);
    expect(res.ok).toBe(true);
    expect(JSON.parse(body.toString("utf8"))).toEqual(batch);
  });

  it("serializes readAt via .toISOString() (never Date.toString())", () => {
    const iso = "2026-07-17T18:00:00.123Z";
    const { batch } = buildEnvelope([mv("E1", "GW-2", iso)]);
    expect(batch.events[0].readAt).toBe(iso);
    expect(batch.events[0].readAt).not.toContain("GMT");
  });

  it("emits ONLY {tagEpc, gatewayCode, readAt} on the wire — directional emission deferred", () => {
    const { batch } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z", "GW-1")]);
    expect(Object.keys(batch.events[0]).sort()).toEqual(["gatewayCode", "readAt", "tagEpc"]);
    // Deliberate deferral (see envelope.ts header): post-R-M1 the route schema
    // and Module 0 contract DO accept directional fields, but the controller has
    // no gateway-role geometry to classify entered/exited, so it emits the
    // minimal safe subset. fromGateway stays internal-only until the hardware
    // direction track wires emission additively.
    expect(batch.events[0]).not.toHaveProperty("fromGateway");
    expect(batch.events[0]).not.toHaveProperty("toGateway");
    expect(batch.events[0]).not.toHaveProperty("direction");
  });

  it("derives a deterministic batchId from content (same events → same id)", () => {
    const a = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z")]);
    const b = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z")]);
    const c = buildEnvelope([mv("E1", "GW-3", "2026-07-17T18:00:00.000Z")]);
    expect(a.batch.batchId).toBe(b.batch.batchId);
    expect(a.batch.batchId).not.toBe(c.batch.batchId);
    expect(a.batch.batchId.length).toBeLessThanOrEqual(64);
  });

  it("honors an explicit batchId and controllerVersion", () => {
    const { batch } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z")], {
      batchId: "explicit-1",
      controllerVersion: "vettrack-rfid/0.1.0",
    });
    expect(batch.batchId).toBe("explicit-1");
    expect(batch.controllerVersion).toBe("vettrack-rfid/0.1.0");
  });

  it("rejects an empty batch and an over-200 batch (matches ingest limits)", () => {
    expect(() => buildEnvelope([])).toThrow();
    const many = Array.from({ length: 201 }, (_, i) => mv(`E${i}`, "GW-1", "2026-07-17T18:00:00.000Z"));
    expect(() => buildEnvelope(many)).toThrow();
  });

  it("keeps a full 200-event batch well under the 512kb body cap", () => {
    const evts = Array.from({ length: 200 }, (_, i) =>
      mv(`E${i.toString().padStart(4, "0")}`, "GW-01", "2026-07-17T18:00:00.000Z"),
    );
    const { body } = buildEnvelope(evts);
    expect(body.length).toBeLessThan(512 * 1024);
  });
});
