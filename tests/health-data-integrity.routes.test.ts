/**
 * Unit tests for GET /health/data-integrity authentication (PR-12).
 *
 * Verifies the production fail-closed contract: the probe exposes
 * tenant-isolation counts and must reject (not serve) when its token is
 * unconfigured or mismatched. Drives the Express Router directly with the
 * DB layer mocked — the auth gate runs before any query.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

const mockPoolQuery = vi.fn();

vi.mock("../server/db.js", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("../server/lib/db-resilience.js", () => ({
  withDbRetry: <T>(fn: () => Promise<T>) => fn(),
  withDbTimeout: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../server/lib/redis.js", () => ({
  safeRedisGet: vi.fn(async () => null),
  getRedisUrl: vi.fn(() => ""),
}));

vi.mock("../server/lib/postgresql.js", () => ({
  isPostgresqlConfigured: vi.fn(() => true),
}));

type Captured = { statusCode: number; body: unknown };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  } as unknown as Response;
  return { res, captured };
}

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    method: "GET",
    url: "/data-integrity",
    originalUrl: "/health/data-integrity",
    body: {},
    headers,
    params: {},
    query: {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/health.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      const ret = origJson(payload);
      setImmediate(finish);
      return ret;
    };
    router(req, res, (err?: unknown) => {
      if (err) console.error("router next error:", err);
      finish();
    });
    setTimeout(finish, 200);
  });
}

const originalNodeEnv = process.env.NODE_ENV;
const originalToken = process.env.DATA_INTEGRITY_HEALTH_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  // All four data-integrity views report clean by default.
  mockPoolQuery.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalToken === undefined) delete process.env.DATA_INTEGRITY_HEALTH_TOKEN;
  else process.env.DATA_INTEGRITY_HEALTH_TOKEN = originalToken;
});

describe("GET /health/data-integrity — production fail-closed auth", () => {
  it("rejects with 503 when the token is not configured", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATA_INTEGRITY_HEALTH_TOKEN;
    const req = makeReq();
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(503);
    expect((captured.body as { reason?: string }).reason).toBe("HEALTH_TOKEN_NOT_CONFIGURED");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the provided token does not match", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATA_INTEGRITY_HEALTH_TOKEN = "correct-token";
    const req = makeReq({ "x-health-token": "wrong-token" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(401);
    expect((captured.body as { reason?: string }).reason).toBe("INVALID_HEALTH_TOKEN");
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("serves 200 when the provided token matches", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATA_INTEGRITY_HEALTH_TOKEN = "correct-token";
    const req = makeReq({ "x-health-token": "correct-token" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect((captured.body as { status?: string }).status).toBe("ok");
  });
});

describe("GET /health/data-integrity — non-production", () => {
  it("serves 200 without a token outside production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.DATA_INTEGRITY_HEALTH_TOKEN;
    const req = makeReq();
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect((captured.body as { status?: string }).status).toBe("ok");
  });
});
