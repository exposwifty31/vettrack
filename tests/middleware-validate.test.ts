import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { validateBody, validateUuid } from "../server/middleware/validate.js";

type FakeRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  statusCode?: number;
  body?: unknown;
};

function makeRes(): FakeRes {
  const res: FakeRes = { status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("validateBody and validateUuid — one error shape", () => {
  it("validateBody responds { error, details: [...] } on a failing schema", () => {
    const schema = z.object({ email: z.string().email() });
    const req = { body: { email: "not-an-email" }, originalUrl: "/x", method: "POST" } as any;
    const res = makeRes();
    const next = vi.fn();

    validateBody(schema)(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: "Validation failed" });
    expect(Array.isArray((res.body as any).details)).toBe(true);
    expect((res.body as any).details.length).toBeGreaterThan(0);
  });

  it("validateUuid rejects a malformed id with the SAME shape as validateBody: { error, details: [] }", () => {
    const req = { params: { id: "not-a-uuid" } } as any;
    const res = makeRes();
    const next = vi.fn();

    validateUuid("id")(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(res.body).toHaveProperty("details");
    expect((res.body as any).details).toEqual([]);
  });

  it("validateUuid calls next() and does not touch res for a valid uuid", () => {
    const req = { params: { id: VALID_UUID } } as any;
    const res = makeRes();
    const next = vi.fn();

    validateUuid("id")(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("validateUuid rejects a missing param the same way", () => {
    const req = { params: {} } as any;
    const res = makeRes();
    const next = vi.fn();

    validateUuid("id")(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect((res.body as any).details).toEqual([]);
  });
});
