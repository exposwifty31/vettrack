/**
 * Phase 6 PR 6.10 CORRECTION 2 — representative migration coverage for
 * the 4 target server routes.
 *
 * Asserts that each of the 4 plan-§15-PR-6.10 routes has at least one
 * 4xx/5xx branch migrated to the i18n-aware `apiError(req, res, key,
 * params?, status?)` helper, and that the migrated branch references
 * the expected `errors.<route>.*` key.
 *
 * Combines static-analysis assertions (which scale across the 4 files)
 * with a representative integration test for stability.ts (drives the
 * Express router directly, asserting Hebrew vs English body on
 * x-locale switch).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown }).authUser = {
      id: "admin-user",
      email: "admin@clinic.test",
      clinicId: "clinic-1",
      role: "admin",
    };
    next();
  },
  requireEffectiveRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/lib/test-runner.js", () => ({
  runAllTests: vi.fn(),
  getReport: vi.fn(() => ({ runs: [], summary: { total: 0, passed: 0, failed: 0 } })),
  isTestRunning: vi.fn(() => false),
  setTestMode: vi.fn(),
  setSchedule: vi.fn(),
  getScheduleHours: vi.fn(() => 24),
  testModeEnabled: vi.fn(() => false),
}));

vi.mock("../server/lib/stability-log.js", () => ({
  getActionLogs: vi.fn(() => []),
  clearActionLogs: vi.fn(),
  logAction: vi.fn(),
}));

interface Captured {
  statusCode: number;
  body: { error?: string; code?: string };
}

function makeReqRes(locale: "en" | "he", method = "GET", url = "/api/sample"): {
  req: Request;
  res: Response;
  captured: Captured;
} {
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
  const req = {
    locale,
    method,
    url,
    originalUrl: url,
    headers: {},
    body: {},
    params: {},
    query: {},
  } as unknown as Request;
  return { req, res, captured };
}

async function dispatchStability(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/stability.js");
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

describe("Phase 6 PR 6.10 CORRECTION 2 — static coverage for 4 migrated routes", () => {
  const stability = readFileSync(resolve(process.cwd(), "server/routes/stability.ts"), "utf-8");
  const erAdmin = readFileSync(resolve(process.cwd(), "server/routes/er-admin.ts"), "utf-8");
  const formulary = readFileSync(resolve(process.cwd(), "server/routes/formulary.ts"), "utf-8");
  const dispense = readFileSync(resolve(process.cwd(), "server/routes/dispense.ts"), "utf-8");

  it("stability.ts imports + uses i18nApiError with errors.stability.* key", () => {
    expect(stability).toMatch(/apiError as i18nApiError/);
    expect(stability).toMatch(/i18nApiError\(req,\s*res,\s*"errors\.stability\.notAvailableInProduction"/);
  });

  it("er-admin.ts imports + uses i18nApiError with errors.er.* key", () => {
    expect(erAdmin).toMatch(/apiError as i18nApiError/);
    expect(erAdmin).toMatch(/i18nApiError\(req,\s*res,\s*"errors\.er\.notAuthenticated"/);
  });

  it("formulary.ts imports + uses i18nApiError with errors.formulary.* key", () => {
    expect(formulary).toMatch(/apiError as i18nApiError/);
    expect(formulary).toMatch(/i18nApiError\(req,\s*res,\s*"errors\.formulary\.notFound"/);
  });

  it("dispense.ts imports + uses i18nApiError with errors.dispense.* key (sendError catch-all)", () => {
    expect(dispense).toMatch(/apiError as i18nApiError/);
    expect(dispense).toMatch(/i18nApiError\(req,\s*res,\s*"errors\.dispense\.internalError"/);
  });

  it("dispense.ts sendError signature now accepts req for locale plumbing", () => {
    expect(dispense).toMatch(/function\s+sendError\(\s*req:\s*Request,\s*res:\s*Response/);
  });
});

describe("Phase 6 PR 6.10 CORRECTION 2 — stability.ts integration (representative)", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it("returns 403 + English body for x-locale=en on requireNotProduction", async () => {
    // `/test-mode` and `/schedule` are gated by requireNotProduction;
    // `/run` is not. Hit a gated route to trigger the 403.
    const { req, res, captured } = makeReqRes("en", "POST", "/test-mode");
    await dispatchStability(req, res);
    expect(captured.statusCode).toBe(403);
    expect(captured.body.error).toBe("Not available in production.");
    expect(captured.body.code).toBe("errors.stability.notAvailableInProduction");
  });

  it("returns 403 + Hebrew body for x-locale=he on requireNotProduction", async () => {
    const { req, res, captured } = makeReqRes("he", "POST", "/test-mode");
    await dispatchStability(req, res);
    expect(captured.statusCode).toBe(403);
    expect(captured.body.error).toBe("לא זמין בסביבת ייצור.");
    expect(captured.body.code).toBe("errors.stability.notAvailableInProduction");
  });
});
