import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import {
  EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS,
  hashEquipmentReplayRequest,
} from "../server/lib/equipment-replay-idempotency.js";

const selectLimitMock = vi.fn();
const onConflictDoUpdateMock = vi.fn();

vi.mock("../server/db.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimitMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: onConflictDoUpdateMock,
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

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe("equipment idempotency collision telemetry", () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
    onConflictDoUpdateMock.mockReset();
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

describe("equipment replay idempotency persist-before-send (#326cc38b)", () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
    onConflictDoUpdateMock.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("defers successful JSON until idempotency row is persisted", async () => {
    selectLimitMock.mockResolvedValue([]);

    let resolveInsert!: () => void;
    const insertDeferred = new Promise<void>((resolve) => {
      resolveInsert = resolve;
    });
    onConflictDoUpdateMock.mockReturnValue(insertDeferred);

    const recorded = makeRes();
    const routeHandler = vi.fn(() => {
      recorded.res.status(200).json({ equipment: { id: "eq-1" } });
    });

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq({ status: "ok" }), recorded.res, routeHandler);

    expect(routeHandler).toHaveBeenCalledOnce();
    expect(onConflictDoUpdateMock).toHaveBeenCalledOnce();
    expect(recorded.body).toBeUndefined();

    resolveInsert();
    await flushMicrotasks();

    expect(recorded.statusCode).toBe(200);
    expect(recorded.body).toEqual({ equipment: { id: "eq-1" } });
  });

  it("still sends JSON when persist fails (fail-open)", async () => {
    selectLimitMock.mockResolvedValue([]);
    onConflictDoUpdateMock.mockRejectedValue(new Error("db unavailable"));

    const recorded = makeRes();
    const routeHandler = vi.fn(() => {
      recorded.res.status(200).json({ equipment: { id: "eq-1" } });
    });

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq({ status: "ok" }), recorded.res, routeHandler);
    await flushMicrotasks();

    expect(recorded.statusCode).toBe(200);
    expect(recorded.body).toEqual({ equipment: { id: "eq-1" } });
    expect(console.error).toHaveBeenCalledWith(
      "[equipment-replay-idempotency] persist failed",
      expect.any(Error),
    );
  });

  it("does not persist non-2xx JSON responses", async () => {
    selectLimitMock.mockResolvedValue([]);

    const recorded = makeRes();
    const routeHandler = vi.fn(() => {
      recorded.res.status(422).json({ code: "VALIDATION_FAILED" });
    });

    const handler = equipmentReplayIdempotency(ROUTE);
    await handler(makeReq({ status: "ok" }), recorded.res, routeHandler);
    await flushMicrotasks();

    expect(onConflictDoUpdateMock).not.toHaveBeenCalled();
    expect(recorded.statusCode).toBe(422);
    expect(recorded.body).toEqual({ code: "VALIDATION_FAILED" });
  });
});
