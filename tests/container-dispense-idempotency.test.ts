/**
 * Container dispense idempotency middleware — replay + COP degraded header (Phase 5 PR 5.7 fix).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { hashDispenseRequestBody } from "../server/lib/dispense-idempotency-hash.js";

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockInsert = vi.fn(() => ({
  values: vi.fn(() => ({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../server/db.js", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
  idempotencyKeys: { clinicId: "clinicId", key: "key" },
}));

import { dispenseIdempotencyMiddleware } from "../server/middleware/container-dispense-idempotency.js";

type Captured = { statusCode: number; body: unknown; headers: Record<string, string> };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null, headers: {} };
  const res = {
    statusCode: 200,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      captured.statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return captured.headers[name.toLowerCase()];
    },
    once(_event: string, _handler: () => void) {
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

function makeReq(body: Record<string, unknown> = { quantityMl: 5 }): Request {
  return {
    headers: { "idempotency-key": "key-abc" },
    clinicId: "clinic-1",
    body,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockResolvedValue([]);
});

describe("dispenseIdempotencyMiddleware", () => {
  it("returns 400 when Idempotency-Key header is missing", async () => {
    const { res, captured } = makeRes();
    const next = vi.fn();
    const req = makeReq();
    req.headers = {};
    await dispenseIdempotencyMiddleware(req, res, next as unknown as NextFunction);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { reason?: string }).reason).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when clinic context is missing", async () => {
    const { res, captured } = makeRes();
    const next = vi.fn();
    const req = makeReq();
    req.clinicId = undefined;
    await dispenseIdempotencyMiddleware(req, res, next as unknown as NextFunction);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { reason?: string }).reason).toBe("CLINIC_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 409 when idempotency key is reused with a different body", async () => {
    mockLimit.mockResolvedValue([
      {
        requestHash: "different-hash",
        statusCode: 200,
        responseBody: { ok: true },
      },
    ]);
    const { res, captured } = makeRes();
    const next = vi.fn();
    await dispenseIdempotencyMiddleware(makeReq(), res, next as unknown as NextFunction);
    expect(captured.statusCode).toBe(409);
    expect((captured.body as { reason?: string }).reason).toBe("IDEMPOTENCY_KEY_BODY_MISMATCH");
    expect(next).not.toHaveBeenCalled();
  });

  it("replays cached response on matching idempotency key + body hash", async () => {
    const body = { quantityMl: 5 };
    const requestHash = hashDispenseRequestBody(body);
    const cached = { dispenseId: "d-1", quantityMl: 5 };
    mockLimit.mockResolvedValue([
      { requestHash, statusCode: 201, responseBody: cached },
    ]);
    const { res, captured } = makeRes();
    const next = vi.fn();
    await dispenseIdempotencyMiddleware(makeReq(body), res, next as unknown as NextFunction);
    expect(captured.statusCode).toBe(201);
    expect(captured.body).toEqual(cached);
    expect(next).not.toHaveBeenCalled();
  });

  it("re-emits X-COP-Validation-Status: degraded on replay when first write was fail-open", async () => {
    const body = { quantityMl: 5 };
    const requestHash = hashDispenseRequestBody(body);
    mockLimit.mockResolvedValue([
      {
        requestHash,
        statusCode: 200,
        responseBody: { dispenseId: "d-1", copValidationDegraded: true },
      },
    ]);
    const { res, captured } = makeRes();
    const next = vi.fn();
    await dispenseIdempotencyMiddleware(makeReq(body), res, next as unknown as NextFunction);
    expect(captured.statusCode).toBe(200);
    expect(res.getHeader("x-cop-validation-status")).toBe("degraded");
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts new idempotency key and forwards to handler", async () => {
    const { res } = makeRes();
    const next = vi.fn();
    await dispenseIdempotencyMiddleware(makeReq(), res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(res.locals.dispenseIdempotencyKey).toBe("key-abc");
  });
});
