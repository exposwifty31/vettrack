/**
 * Phase 6 PR 6.10 CORRECTION 2 — representative migration coverage for
 * remaining migrated server routes (dispense.ts).
 *
 * er-admin.ts and formulary.ts were removed with their admin surfaces.
 *
 * stability.ts was removed in the tier-2 audit remediation (docs/audit/
 * route-consumer-triage.md §C.1): /stability had already been reduced to a
 * redirect stub in src/app/routes.tsx, so the whole /api/stability family had
 * no consumer. Its static assertion and its two-case en/he integration test
 * went with it, along with the test-runner and stability-log mocks they needed.
 *
 * What those cases actually proved was that a migrated route renders its
 * localized body per `x-locale`. That property is re-established below for
 * dispense.ts — against its REAL localized path, which is the 500 catch-all
 * (`errors.dispense.internalError`, dispense.ts:85), NOT a 403: this router has
 * no route-local 403 at all (`grep -c 403 server/routes/dispense.ts` → 0). An
 * earlier revision of this header claimed 403 coverage; that was wrong, and the
 * static assertions alone would not have caught the regression the removed
 * integration cases did.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = {
      id: "admin-user",
      email: "admin@clinic.test",
      clinicId: "clinic-1",
      role: "admin",
    };
    (req as Request & { clinicId?: string }).clinicId = "clinic-1";
    next();
  },
  requireEffectiveRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  validateUuid: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: vi.fn(() => "admin"),
}));

// The unexpected failure that must reach the localized 500 catch-all.
vi.mock("../server/services/dispense.service.js", () => {
  // The route narrows on these two classes before reaching the catch-all, so the
  // mock must export them or the module fails to load. A plain Error is neither,
  // which is exactly the "unexpected failure" path under test.
  class DispenseError extends Error {}
  class ClinicalInvariantDenyError extends Error {}
  return {
    DispenseError,
    ClinicalInvariantDenyError,
    createDraftDispense: vi.fn(async () => {
      throw new Error("forced failure — exercising the i18n 500 catch-all");
    }),
    confirmDispense: vi.fn(),
    createEmergencyDispense: vi.fn(),
  };
});

interface Captured {
  statusCode: number;
  body: { error?: string; code?: string };
}

function makeReqRes(locale: "en" | "he", method = "POST", url = "/draft"): {
  req: Request;
  res: Response;
  captured: Captured;
} {
  const captured: Captured = { statusCode: 0, body: {} };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload as Captured["body"];
      return this;
    },
    setHeader() {
      return this;
    },
    getHeader() {
      return undefined;
    },
  } as unknown as Response;

  const req = {
    method,
    url,
    originalUrl: `/api/dispense${url}`,
    path: url,
    headers: { "x-locale": locale },
    locale,
    body: {},
    params: {},
    query: {},
  } as unknown as Request;
  return { req, res, captured };
}

async function dispatchDispense(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/dispense.js");
  await new Promise<void>((done) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      done();
    };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      const ret = (origJson as (p: unknown) => Response)(payload);
      setImmediate(finish);
      return ret;
    };
    (router as unknown as (r: Request, s: Response, cb: (err?: unknown) => void) => void)(
      req,
      res,
      (err?: unknown) => {
        if (err) console.error("router next error:", err);
        finish();
      },
    );
    setTimeout(finish, 200);
  });
}

describe("Phase 6 PR 6.10 CORRECTION 2 — static coverage for migrated routes", () => {
  const dispense = readFileSync(resolve(process.cwd(), "server/routes/dispense.ts"), "utf-8");

  it("dispense.ts imports + uses i18nApiError with errors.dispense.* key (sendError catch-all)", () => {
    expect(dispense).toMatch(/apiError as i18nApiError/);
    expect(dispense).toMatch(/i18nApiError\(req,\s*res,\s*"errors\.dispense\.internalError"/);
  });

  it("dispense.ts sendError signature now accepts req for locale plumbing", () => {
    expect(dispense).toMatch(/function\s+sendError\(\s*req:\s*Request,\s*res:\s*Response/);
  });

  it("dispense.ts has no route-local 403 — its localized path is the 500 catch-all", () => {
    // Pins the premise of the integration cases below, so a future 403 branch
    // cannot silently make them the wrong test.
    expect(dispense).not.toMatch(/\b403\b/);
  });
});

describe("Phase 6 PR 6.10 CORRECTION 2 — dispense.ts integration (representative)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns 500 + English body for x-locale=en on an unexpected failure", async () => {
    const { req, res, captured } = makeReqRes("en");
    await dispatchDispense(req, res);
    expect(captured.statusCode).toBe(500);
    expect(captured.body.code).toBe("errors.dispense.internalError");
    expect(captured.body.error).toBeTruthy();
    const english = captured.body.error as string;
    expect(/[֐-׿]/.test(english)).toBe(false);
  });

  it("returns 500 + Hebrew body for x-locale=he on the same failure", async () => {
    const { req, res, captured } = makeReqRes("he");
    await dispatchDispense(req, res);
    expect(captured.statusCode).toBe(500);
    expect(captured.body.code).toBe("errors.dispense.internalError");
    // The point of the whole PR-6.10 migration: same code, locale-dependent body.
    expect(/[֐-׿]/.test(captured.body.error as string)).toBe(true);
  });
});
