import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NextFunction, Request, Response } from "express";
import { validateBody, validateUuid } from "../server/middleware/validate.js";

type ValidationBody = { error: string; details: Array<{ field?: string; message?: string }> };

interface FakeReq {
  body?: unknown;
  params?: Record<string, string>;
  originalUrl?: string;
  method?: string;
}

interface FakeRes {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  statusCode?: number;
  body?: ValidationBody;
}

// validateBody/validateUuid only read req.body/req.params/req.originalUrl/req.method
// and only call res.status(...).json(...) — a fraction of Express's real Request/
// Response contracts. Rather than scatter `as any` at every call site, the boundary
// cast lives once, here, and everything the tests touch afterward is fully typed.
function asRequest(req: FakeReq): Request {
  return req as unknown as Request;
}

function makeRes(): FakeRes {
  const res: FakeRes = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: ValidationBody) => {
    res.body = body;
    return res;
  });
  return res;
}

function asResponse(res: FakeRes): Response {
  return res as unknown as Response;
}

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("validateBody and validateUuid — one error shape", () => {
  it("validateBody responds { error, details: [...] } on a failing schema", () => {
    const schema = z.object({ email: z.string().email() });
    const req = asRequest({ body: { email: "not-an-email" }, originalUrl: "/x", method: "POST" });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    validateBody(schema)(req, asResponse(res), next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: "Validation failed" });
    expect(Array.isArray(res.body?.details)).toBe(true);
    expect(res.body?.details.length).toBeGreaterThan(0);
  });

  it("validateUuid rejects a malformed id with the SAME shape as validateBody: { error, details: [] }", () => {
    const req = asRequest({ params: { id: "not-a-uuid" } });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    validateUuid("id")(req, asResponse(res), next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("details");
    expect(res.body?.details).toEqual([]);
  });

  it("validateUuid calls next() and does not touch res for a valid uuid", () => {
    const req = asRequest({ params: { id: VALID_UUID } });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    validateUuid("id")(req, asResponse(res), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("validateUuid rejects a missing param the same way", () => {
    const req = asRequest({ params: {} });
    const res = makeRes();
    const next: NextFunction = vi.fn();

    validateUuid("id")(req, asResponse(res), next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body?.details).toEqual([]);
  });
});
