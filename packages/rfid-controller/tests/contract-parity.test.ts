import { describe, expect, it, vi } from "vitest";

// The real route schema pulls in `server/db.ts` transitively (via the
// provisioning import chain), which throws at module load without a
// DATABASE_URL. We only need the exported zod schema as a drift oracle — never
// a DB — so stub the db module exactly like tests/rfid-webhook-signature.test.ts
// does. This keeps the parity test dependency-light AND single-source (no
// duplicated schema file to drift out of sync).
vi.mock("../../../server/db.js", () => ({ db: {} }));

// Drift oracle: the REAL server-side zod schema the ingest validates against
// (exported from the route itself — R-M1 folded the batch schema back into
// server/routes/rfid.ts, so there is no separate schema file to duplicate).
// If the route contract ever drifts from the controller's zero-dep canonical
// validator, this test fails in CI.
import { RfidBatchSchema } from "../../../server/routes/rfid";
import { validateRfidBatch } from "../src/contract";

function base() {
  return {
    batchId: "b1",
    controllerVersion: "c/1",
    events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06.123Z" }],
  };
}

const READ_AT = "2026-07-17T18:18:06Z";

// A battery spanning every boundary + a range of RFC-3339 shapes and near-misses.
const battery: unknown[] = [
  base(),
  { ...base(), controllerVersion: undefined },
  { batchId: "b", events: base().events },
  42,
  null,
  undefined,
  "string",
  {},
  { ...base(), batchId: "" },
  { ...base(), batchId: "x".repeat(64) },
  { ...base(), batchId: "x".repeat(65) },
  { ...base(), controllerVersion: "x".repeat(32) },
  { ...base(), controllerVersion: "x".repeat(33) },
  { ...base(), events: [] },
  { ...base(), events: new Array(200).fill(base().events[0]) },
  { ...base(), events: new Array(201).fill(base().events[0]) },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06.999999Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06.1Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06+00:00" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-13-01T00:00:00Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-02-29T00:00:00Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2025-02-29T00:00:00Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T24:00:00Z" }] },
  { ...base(), events: [{ tagEpc: "", gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "", readAt: "2026-07-17T18:18:06Z" }] },
  { ...base(), events: [{ tagEpc: "x".repeat(128), gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06Z" }] },
  { ...base(), events: [{ tagEpc: "x".repeat(129), gatewayCode: "GW-1", readAt: "2026-07-17T18:18:06Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "x".repeat(64), readAt: "2026-07-17T18:18:06Z" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "x".repeat(65), readAt: "2026-07-17T18:18:06Z" }] },
  // unknown fields: zod is non-.strict() → strips (accepts); the controller
  // validator must agree on the accept/reject verdict.
  { ...base(), extra: "field", events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, zone: "north" }] },

  // ---- R-M1.2a directional fields (direction enum + fromGateway/toGateway,
  // both-or-neither). The controller contract must mirror the exported schema
  // exactly on every one of these. ----
  // direction enum: valid members accepted.
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, direction: "entered" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, direction: "exited" }] },
  // direction enum: an out-of-enum value is a hard reject (NOT a stripped unknown).
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, direction: "in" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, direction: "" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, direction: 1 }] },
  // gateway pair: both present + valid → accept.
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, fromGateway: "GW-A", toGateway: "GW-B" }] },
  // gateway pair: partial pair → reject (both-or-neither).
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, fromGateway: "GW-A" }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, toGateway: "GW-B" }] },
  // gateway pair: both present but one out of range → reject.
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, fromGateway: "GW-A", toGateway: "x".repeat(65) }] },
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, fromGateway: "", toGateway: "GW-B" }] },
  // all three directional fields present + valid → accept.
  { ...base(), events: [{ tagEpc: "E1", gatewayCode: "GW-1", readAt: READ_AT, direction: "entered", fromGateway: "GW-A", toGateway: "GW-B" }] },
];

describe("contract parity — controller validator vs real route zod schema", () => {
  for (let i = 0; i < battery.length; i += 1) {
    const input = battery[i];
    it(`agrees on accept/reject for case #${i}`, () => {
      const zodOk = RfidBatchSchema.safeParse(input).success;
      const ctrlOk = validateRfidBatch(input).ok;
      expect(ctrlOk).toBe(zodOk);
    });
  }
});
