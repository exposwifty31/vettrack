import { describe, expect, it, vi } from "vitest";

import type { MovementEvent } from "../src/aggregate";
import { validateRfidBatch, type RfidDirection } from "../src/contract";
import { buildEnvelope } from "../src/envelope";

// The real route schema pulls in `server/db.ts` transitively (via the
// provisioning import chain), which throws at module load without a
// DATABASE_URL. We only need the exported zod schema as a drift oracle — never
// a DB — so stub the db module exactly like tests/contract-parity.test.ts does.
vi.mock("../../../server/db.js", () => ({ db: {} }));
// eslint-disable-next-line import/first
import { RfidBatchSchema } from "../../../server/routes/rfid";

function mv(
  tagEpc: string,
  gatewayCode: string,
  iso: string,
  from: string | null = null,
  direction?: RfidDirection,
): MovementEvent {
  return {
    tagEpc,
    gatewayCode,
    readAt: new Date(iso),
    fromGateway: from,
    ...(direction !== undefined ? { direction } : {}),
  };
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

  it("a first sighting (no origin) emits ONLY the minimal triple — the gateway pair is both-or-neither", () => {
    // fromGateway === null → no resolved origin, so the schema's both-or-neither
    // pair rule means NEITHER fromGateway nor toGateway is serialized.
    const { batch } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z", null)]);
    expect(Object.keys(batch.events[0]).sort()).toEqual(["gatewayCode", "readAt", "tagEpc"]);
    expect(batch.events[0]).not.toHaveProperty("fromGateway");
    expect(batch.events[0]).not.toHaveProperty("toGateway");
    expect(batch.events[0]).not.toHaveProperty("direction");
  });

  it("a resolved crossing serializes the fromGateway/toGateway pair (toGateway = destination gatewayCode)", () => {
    const { batch } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z", "GW-1")]);
    const ev = batch.events[0];
    expect(ev.fromGateway).toBe("GW-1");
    expect(ev.toGateway).toBe("GW-2"); // destination = where the tag now is
    expect(ev.gatewayCode).toBe("GW-2");
  });

  it("a crossing carrying a classified direction serializes direction alongside the pair", () => {
    const { batch } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.000Z", "GW-1", "entered")]);
    const ev = batch.events[0];
    expect(ev.direction).toBe("entered");
    expect(ev.fromGateway).toBe("GW-1");
    expect(ev.toGateway).toBe("GW-2");
  });

  it("a directional envelope validates against the REAL exported RfidBatchSchema (and the signed bytes match)", () => {
    const { batch, body } = buildEnvelope([mv("E1", "GW-2", "2026-07-17T18:00:00.123Z", "GW-1", "entered")]);
    const parsed = RfidBatchSchema.safeParse(batch);
    expect(parsed.success).toBe(true);
    // The exact bytes signed & sent must be the serialization of the validated batch.
    expect(JSON.parse(body.toString("utf8"))).toEqual(batch);
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
