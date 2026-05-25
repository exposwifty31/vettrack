import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import {
  EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS,
  hashEquipmentReplayRequest,
} from "../server/lib/equipment-replay-idempotency.js";

const selectLimitMock = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
  },
  idempotencyKeys: {},
}));

const { equipmentReplayIdempotency, logger } = await import(
  "../server/middleware/equipment-replay-idempotency.js"
);

const ROUTE = EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.scan;
const PATH = "/api/equipment/eq-1/scan";

function makeRes(): { res: Response; statusCode: number; body: unknown } {
  let statusCode = 200;
  let body: unknown;
  const res = {
    get statusCode() {
      return statusCode;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    send() {
      return this;
    },
  } as unknown as Response;
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

function makeReq(body: unknown, idempotencyKey = "key-1"): Request {
  return {
    method: "POST",
    originalUrl: PATH,
    url: PATH,
    body,
    headers: { "idempotency-key": idempotencyKey },
    clinicId: "clinic-1",
    authUser: { id: "user-1", email: "u@test.local", role: "technician" },
  } as unknown as Request;
}

describe("equipment idempotency collision telemetry", () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(logger, "info").mockImplementation(() => {});
  });

  it("first write with no cached row does not emit replay_idempotency_collision", async () => {
    selectLimitMock.mockResolvedValue([]);
    const next = vi.fn();
    const recorded = makeRes();
    const body = { status: "ok", note: "first" };

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq(body), recorded.res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("body mismatch collision emits replay_idempotency_collision", async () => {
    const firstBody = { status: "ok", note: "alpha" };
    const secondBody = { status: "ok", note: "beta" };
    const firstHash = hashEquipmentReplayRequest("POST", PATH, firstBody);

    selectLimitMock.mockResolvedValue([
      {
        requestHash: firstHash,
        statusCode: 200,
        responseBody: { equipment: { id: "eq-1" } },
      },
    ]);

    const next = vi.fn();
    const recorded = makeRes();

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq(secondBody), recorded.res, next);

    expect(next).not.toHaveBeenCalled();
    expect(recorded.statusCode).toBe(409);
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith("replay_idempotency_collision", {
      route: ROUTE,
      outcome: "IDEMPOTENCY_KEY_BODY_MISMATCH",
    });
  });

  it("same-hash replay from cache does not emit replay_idempotency_collision", async () => {
    const body = { status: "ok", note: "same" };
    const requestHash = hashEquipmentReplayRequest("POST", PATH, body);

    selectLimitMock.mockResolvedValue([
      {
        requestHash,
        statusCode: 200,
        responseBody: { equipment: { id: "eq-1" } },
      },
    ]);

    const next = vi.fn();
    const recorded = makeRes();

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq(body), recorded.res, next);

    expect(next).not.toHaveBeenCalled();
    expect(recorded.statusCode).toBe(200);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
