/**
 * Phase 6 PR 6.3 — integration tests for the two light-adoption sites in
 * `server/routes/test.ts`:
 *   - `requireNotProduction` 403 → `errors.test.notAvailableInProduction`
 *   - `requireTestMode` 404 → `errors.notFound`
 *
 * Asserts Hebrew vs English body content on `x-locale` switch and that
 * the `code` field equals the resolved key path.
 *
 * Drives the Express router directly with mocked req/res + mocked auth
 * (no supertest), matching the pattern in
 * `tests/clinical-check-in.routes.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

let isTestModeReturn = true;

vi.mock("../server/lib/test-mode.js", () => ({
  isTestMode: () => isTestModeReturn,
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown }).authUser = {
      id: "test-user",
      email: "test@clinic.test",
      clinicId: "clinic-1",
      role: "admin",
    };
    next();
  },
}));

vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

interface Captured {
  statusCode: number;
  body: { error?: string; code?: string; params?: Record<string, unknown> };
}

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 0, body: {} };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Captured["body"]) {
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

function makeReq(opts: {
  method: string;
  url: string;
  locale: "en" | "he";
  headers?: Record<string, string>;
}): Request {
  return {
    method: opts.method,
    url: opts.url,
    originalUrl: opts.url,
    body: {},
    headers: opts.headers ?? {},
    params: {},
    query: {},
    locale: opts.locale,
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/test.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      const ret = (origJson as (p: unknown) => Response)(payload);
      setImmediate(finish);
      return ret;
    };
    (router as unknown as (
      r: Request,
      s: Response,
      cb: (err?: unknown) => void,
    ) => void)(req, res, (err?: unknown) => {
      if (err) console.error("router next error:", err);
      finish();
    });
    setTimeout(finish, 200);
  });
}

describe("Phase 6 PR 6.3 — test.ts requireNotProduction 403 adoption", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    isTestModeReturn = true;
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("returns 403 + English body for x-locale=en", async () => {
    const req = makeReq({ method: "POST", url: "/run-scheduler", locale: "en" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(403);
    expect(captured.body.error).toBe("Not available in production.");
    expect(captured.body.code).toBe("errors.test.notAvailableInProduction");
  });

  it("returns 403 + Hebrew body for x-locale=he", async () => {
    const req = makeReq({ method: "POST", url: "/run-scheduler", locale: "he" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(403);
    expect(captured.body.error).toBe("לא זמין בסביבת ייצור.");
    expect(captured.body.code).toBe("errors.test.notAvailableInProduction");
  });
});

describe("Phase 6 PR 6.3 — test.ts requireTestMode 404 adoption", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    isTestModeReturn = false;
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    isTestModeReturn = true;
  });

  it("returns 404 + English body for x-locale=en", async () => {
    const req = makeReq({ method: "POST", url: "/run-scheduler", locale: "en" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(404);
    expect(captured.body.error).toBe("Resource not found.");
    expect(captured.body.code).toBe("errors.notFound");
  });

  it("returns 404 + Hebrew body for x-locale=he", async () => {
    const req = makeReq({ method: "POST", url: "/run-scheduler", locale: "he" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(404);
    expect(captured.body.error).toBe("המשאב לא נמצא.");
    expect(captured.body.code).toBe("errors.notFound");
  });
});
