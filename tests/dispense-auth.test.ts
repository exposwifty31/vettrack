/**
 * Dispense endpoint authentication tests.
 *
 * T26 reclassified inventory dispense as NON-clinical consumables work (drug
 * formulary removed, migrations 142-143): the router now gates on
 * `requireEffectiveRole("student")` (the role floor — admits ALL authenticated
 * staff, including a supervised student) instead of the old
 * `requireClinicalUser` + per-endpoint `requireClinicalAuthority`. Clinical
 * authority (STUDENT_NEVER_ELEVATED / requireClinicalAuthority) is untouched and
 * still gates Code Blue + genuinely-clinical routes.
 *
 * Covers:
 * - Unauthenticated requests to the three mutation endpoints return 401
 * - Authenticated requests pass through requireAuth to the handler
 * - The router-level gate is requireEffectiveRole("student"), not clinical authority
 * - Middleware order: requireAuth executes before handler
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Request, Response, NextFunction } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const dispenseSource = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "dispense.ts"),
  "utf8",
);

// ── Static structure assertions ───────────────────────────────────────────────

describe("dispense.ts static structure (T26: non-clinical consumables dispense)", () => {
  it("imports requireAuth", () => {
    expect(dispenseSource).toMatch(/import\s*\{[^}]*requireAuth[^}]*\}\s*from/);
  });

  it("imports requireEffectiveRole (the student-floor role gate)", () => {
    expect(dispenseSource).toMatch(/import\s*\{[^}]*requireEffectiveRole[^}]*\}\s*from/);
  });

  it("applies requireEffectiveRole(\"student\") at router level via router.use()", () => {
    expect(dispenseSource).toMatch(
      /router\.use\s*\([^)]*requireAuth[^)]*requireEffectiveRole\(\s*["']student["']\s*\)[^)]*\)/,
    );
  });

  it("requireAuth is applied at router level via router.use()", () => {
    expect(dispenseSource).toMatch(
      /router\.use\s*\([^)]*requireAuth[^)]*\)/,
    );
  });

  it("no TODO(Phase 2B) markers remain", () => {
    const matches = dispenseSource.match(/TODO\(Phase 2B\)/g);
    expect(matches).toBeNull();
  });

  it("no dispense endpoint is gated by clinical authority (reclassified non-clinical)", () => {
    const needle = ["require", "Clinical", "Authority"].join("") + "\\(";
    const matches = dispenseSource.match(new RegExp(needle, "g"));
    expect(matches).toBeNull();
  });

  it("does not gate students out via requireClinicalUser (students may dispense consumables)", () => {
    expect(dispenseSource).not.toContain("requireClinicalUser");
  });
});

// ── Middleware unit tests ─────────────────────────────────────────────────────

type JsonBody = Record<string, unknown>;

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const state: { statusCode: number; body: JsonBody | null } = {
    statusCode: 200,
    body: null,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: JsonBody) {
      state.body = payload;
      return this;
    },
    getHeader() {
      return undefined;
    },
    setHeader() {},
  } as unknown as Response;
  return { res, state };
}

function makeNext(): { next: NextFunction; wasCalled: () => boolean } {
  let called = false;
  const next: NextFunction = () => {
    called = true;
  };
  return { next, wasCalled: () => called };
}

let createRequireAuth: (
  resolver: (req: Request) => Promise<unknown>,
) => (req: Request, res: Response, next: NextFunction) => Promise<void>;

beforeAll(async () => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/vettrack_test";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const mod = await import("../server/middleware/auth.js");
  createRequireAuth = mod.createRequireAuth as typeof createRequireAuth;
}, 30_000);

describe("requireAuth middleware behaviour (dispense context)", () => {
  it("unauthenticated resolver → does NOT call next", async () => {
    const mw = createRequireAuth(async () => ({
      ok: false,
      status: 401,
      body: { error: "Unauthorized" },
    }));
    const { next, wasCalled } = makeNext();
    await mw(makeReq(), makeRes().res, next);
    expect(wasCalled()).toBe(false);
  });

  it("unauthenticated resolver → returns 401", async () => {
    const mw = createRequireAuth(async () => ({
      ok: false,
      status: 401,
      body: { error: "Unauthorized" },
    }));
    const { res, state } = makeRes();
    const { next } = makeNext();
    await mw(makeReq(), res, next);
    expect(state.statusCode).toBe(401);
  });

  it("authenticated resolver → calls next (handler continues)", async () => {
    const mw = createRequireAuth(async () => ({
      ok: true,
      user: {
        id: "u-dispense-1",
        clerkId: "clerk-1",
        email: "tech@vettrack.dev",
        name: "Tech User",
        role: "technician",
        status: "active",
        locale: "en",
        clinicId: "dev-clinic-default",
      },
    }));
    const { next, wasCalled } = makeNext();
    await mw(makeReq(), makeRes().res, next);
    expect(wasCalled()).toBe(true);
  });

  it("authenticated resolver → does NOT produce a 4xx/5xx response", async () => {
    const mw = createRequireAuth(async () => ({
      ok: true,
      user: {
        id: "u-dispense-2",
        clerkId: "clerk-2",
        email: "vet@vettrack.dev",
        name: "Vet User",
        role: "vet",
        status: "active",
        locale: "he",
        clinicId: "dev-clinic-default",
      },
    }));
    const { res, state } = makeRes();
    const { next } = makeNext();
    await mw(makeReq(), res, next);
    expect(state.statusCode).toBe(200);
  });

  it("requireAuth sets req.authUser and req.clinicId on success", async () => {
    const mw = createRequireAuth(async () => ({
      ok: true,
      user: {
        id: "u-dispense-3",
        clerkId: "clerk-3",
        email: "admin@vettrack.dev",
        name: "Admin",
        role: "admin",
        status: "active",
        locale: "en",
        clinicId: "clinic-xyz",
      },
    }));
    const req = makeReq();
    const { next } = makeNext();
    await mw(req, makeRes().res, next);
    const typed = req as Request & { authUser?: { id: string }; clinicId?: string };
    expect(typed.authUser?.id).toBe("u-dispense-3");
    expect(typed.clinicId).toBe("clinic-xyz");
  });

  it("middleware order: requireAuth runs before handler (next must be called first)", async () => {
    const order: string[] = [];
    const mw = createRequireAuth(async () => {
      order.push("requireAuth");
      return {
        ok: true,
        user: {
          id: "u1",
          clerkId: "c1",
          email: "e@v.dev",
          name: "U",
          role: "technician",
          status: "active",
          locale: "en",
          clinicId: "c",
        },
      };
    });
    const handlerNext: NextFunction = () => {
      order.push("handler");
    };
    await mw(makeReq(), makeRes().res, handlerNext);
    expect(order).toEqual(["requireAuth", "handler"]);
  });
});

// ── Regression: dispense is non-clinical (T26) ────────────────────────────────

describe("regression: dispense reclassified non-clinical (T26)", () => {
  it("requireEffectiveRole(\"student\") is the router-level gate", () => {
    expect(dispenseSource).toContain('requireEffectiveRole("student")');
  });

  it("requireClinicalAuthority is NOT imported or used in dispense.ts", () => {
    expect(dispenseSource).not.toContain("requireClinicalAuthority");
  });
});
