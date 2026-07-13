/**
 * T-23a (R-EQ-F2) — GET /api/equipment/:id must surface the already-derived
 * readinessState (computeBundleReadinessGate() → equipment.readinessState,
 * persisted at write time by the operational-state write paths, e.g. the
 * dock-return flow in server/routes/equipment-operational-state.ts) as an
 * additive, non-breaking field on the by-id read payload.
 *
 * This does not re-derive readiness logic — it only locks in that the by-id
 * handler continues to project the already-computed column (via
 * equipmentOperationalStateSelect) and that every pre-existing key on the
 * payload — plus the response type — stays intact alongside it.
 *
 * Two layers:
 *  - Projection contract (source-based, matches the sibling handler test
 *    convention in this directory, e.g. equipment-confirm-in-room.test.ts):
 *    proves the SELECT literal actually includes readinessState and the rest
 *    of the V1 operational fields.
 *  - Passthrough contract (mocked db): proves the handler forwards whatever
 *    the query resolves without dropping or renaming fields.
 *
 * Hermetic: db is mocked, so this runs in the default `pnpm test` suite
 * without a database.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import type { Request, Response } from "express";

const handlerSource = fs.readFileSync(
  "server/routes/equipment/handlers/get-equipment-by-id.ts",
  "utf8",
);
const operationalSelectSource = fs.readFileSync(
  "server/routes/equipment/equipment-operational-select.ts",
  "utf8",
);
const equipmentTypesSource = fs.readFileSync("src/types/equipment.ts", "utf8");

describe("GET /api/equipment/:id — readinessState projection contract (T-23a · R-EQ-F2)", () => {
  it("spreads equipmentOperationalStateSelect (readinessState + the rest of V1) onto the by-id select", () => {
    expect(handlerSource).toContain("...equipmentOperationalStateSelect");
    expect(operationalSelectSource).toContain("readinessState: equipment.readinessState");
  });

  it("keeps every pre-existing V1 operational key alongside readinessState (additive, non-breaking)", () => {
    for (const field of ["custodyState", "usageState", "assetTypeId", "dockId"]) {
      expect(operationalSelectSource).toContain(`${field}: equipment.${field}`);
    }
  });

  it("keeps pre-existing non-operational read fields untouched (additive, non-breaking)", () => {
    for (const field of [
      "id: equipment.id",
      "name: equipment.name",
      "serialNumber: equipment.serialNumber",
      "status: equipment.status",
      "checkedOutById: equipment.checkedOutById",
      "createdAt: equipment.createdAt",
    ]) {
      expect(handlerSource).toContain(field);
    }
  });

  it("types the response field on the shared Equipment interface", () => {
    expect(equipmentTypesSource).toContain(
      'readinessState?: "ready" | "not_ready" | "unknown" | null;',
    );
  });
});

const h = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
}));

vi.mock("../server/db.js", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(h.selectResults.shift() ?? []);
  const columnProxy = () => new Proxy({}, { get: (_target, prop) => prop });
  return {
    db: { select: () => chain },
    equipment: columnProxy(),
    folders: columnProxy(),
    rooms: columnProxy(),
    users: columnProxy(),
  };
});

import { getEquipmentByIdHandler } from "../server/routes/equipment/handlers/get-equipment-by-id.js";

function makeReq(id: string): Request {
  return {
    clinicId: "clinic-1",
    params: { id },
    headers: {},
  } as unknown as Request;
}

function makeRes(): { res: Response; captured: { statusCode: number; body: unknown } } {
  const captured: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const res: Partial<Response> = {
    getHeader: () => undefined,
    setHeader: () => res as Response,
    status(code: number) {
      captured.statusCode = code;
      return res as Response;
    },
    json(body: unknown) {
      captured.body = body;
      return res as Response;
    },
  };
  return { res: res as Response, captured };
}

describe("GET /api/equipment/:id — readinessState passthrough contract (T-23a · R-EQ-F2)", () => {
  it("carries the already-derived readinessState on the by-id payload", async () => {
    h.selectResults.push([
      {
        id: "eq-1",
        name: "Pump 05",
        serialNumber: "SN-1",
        status: "ok",
        custodyState: "docked",
        readinessState: "ready",
        usageState: "available",
        assetTypeId: "type-1",
        dockId: "dock-1",
        checkedOutById: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const { res, captured } = makeRes();

    await getEquipmentByIdHandler(makeReq("eq-1"), res, vi.fn());

    expect(captured.statusCode).toBe(200);
    const body = captured.body as Record<string, unknown>;
    expect(body.readinessState).toBe("ready");
    // Additive: pre-existing keys travel through unchanged alongside it.
    for (const key of ["id", "name", "serialNumber", "status", "custodyState", "usageState", "assetTypeId", "dockId"]) {
      expect(body).toHaveProperty(key);
    }
  });

  it("forwards readinessState for a non-ready unit without altering other fields", async () => {
    h.selectResults.push([
      {
        id: "eq-2",
        name: "Pump 06",
        serialNumber: "SN-2",
        status: "ok",
        custodyState: "checked_out",
        readinessState: "not_ready",
        usageState: "in_use",
        assetTypeId: "type-2",
        dockId: null,
        checkedOutById: "user-1",
        checkedOutByEmail: "tech@example.com",
        checkedOutAt: new Date("2026-01-02T00:00:00Z"),
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);
    const { res, captured } = makeRes();

    await getEquipmentByIdHandler(makeReq("eq-2"), res, vi.fn());

    const body = captured.body as Record<string, unknown>;
    expect(body.readinessState).toBe("not_ready");
    expect(body.checkedOutById).toBe("user-1");
    expect(body.custodyState).toBe("checked_out");
  });

  it("leaves the 404 not-found contract unchanged when no row matches", async () => {
    h.selectResults.push([]);
    const { res, captured } = makeRes();

    await getEquipmentByIdHandler(makeReq("missing"), res, vi.fn());

    expect(captured.statusCode).toBe(404);
    expect((captured.body as Record<string, unknown>).reason).toBe("EQUIPMENT_NOT_FOUND");
  });
});
