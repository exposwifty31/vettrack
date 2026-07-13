/**
 * Unit tests for POST /api/inventory-items — isBillable + minimumDispenseToCapture
 * on create (T-28a · R-IN-01 · CLICK-PATH-018).
 *
 * Prior to this fix, `createItemSchema` only carried these two fields on
 * `updateItemSchema`; a new item could never be created billable or with a
 * capture threshold — callers had to create, then immediately PATCH.
 *
 * Drives the Express Router directly (no supertest, no live server), mirroring
 * tests/equipment-locate-route.test.ts: auth is mocked, drizzle-orm query
 * builders are mocked to pass-through wrappers, and server/db.js is mocked to
 * capture exactly what the route inserts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

// ── Auth mock ────────────────────────────────────────────────────────────────

type TestAuthUser = { id: string; email: string; clinicId: string; role: string };

let currentAuthUser: TestAuthUser | null = {
  id: "user-admin",
  email: "admin@clinic.test",
  clinicId: "clinic-1",
  role: "admin",
};

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({ code: "UNAUTHORIZED", error: "UNAUTHORIZED", reason: "UNAUTHORIZED", message: "Unauthorized" });
      return;
    }
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => {
    const authUser = (req as Request & { authUser?: TestAuthUser }).authUser;
    if (!authUser || authUser.role !== "admin") {
      res.status(403).json({ code: "ACCESS_DENIED", error: "ACCESS_DENIED", reason: "INSUFFICIENT_ROLE", message: "Admin access required" });
      return;
    }
    next();
  },
  requireEffectiveRole: (_minRole: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Audit mock — fire-and-forget, not under test here ───────────────────────

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: (source: { authUser?: { role?: string } }) => source.authUser?.role ?? null,
}));

// ── drizzle-orm — pass-through predicate builders (mocked db ignores them) ───

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  asc: (a: unknown) => ({ _type: "asc", a }),
  desc: (a: unknown) => ({ _type: "desc", a }),
  isNull: (a: unknown) => ({ _type: "isNull", a }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// ── DB mock — captures exactly what the route inserts ────────────────────────

let insertedValues: Record<string, unknown> | null = null;

vi.mock("../server/db.js", () => ({
  db: {
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        insertedValues = v;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(insertedValues ? [{ ...insertedValues }] : []),
        }),
      }),
    }),
  },
  inventoryItems: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
  inventoryItemPrices: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
  containers: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
  containerItems: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
  users: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
}));

// ── Fake req/res helpers (same convention as equipment-locate-route.test.ts) ──

type Captured = { statusCode: number; body: Record<string, unknown> };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: {} };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
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

function makeReq(body: Record<string, unknown>): Request {
  return {
    method: "POST",
    url: "/",
    originalUrl: "/api/inventory-items",
    headers: {},
    params: {},
    query: {},
    body,
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/inventory-items.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      const ret = origJson(payload as Record<string, unknown>);
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

beforeEach(() => {
  vi.clearAllMocks();
  currentAuthUser = { id: "user-admin", email: "admin@clinic.test", clinicId: "clinic-1", role: "admin" };
  insertedValues = null;
});

describe("POST /api/inventory-items — isBillable + minimumDispenseToCapture (T-28a)", () => {
  it("persists isBillable + minimumDispenseToCapture on the created row", async () => {
    const req = makeReq({
      code: "ITEM_BILLABLE_1",
      label: "Billable Test Item",
      isBillable: false,
      minimumDispenseToCapture: 5,
    });
    const { res, captured } = makeRes();

    await dispatch(req, res);

    expect(captured.statusCode).toBe(201);
    expect(insertedValues).not.toBeNull();
    expect(insertedValues?.isBillable).toBe(false);
    expect(insertedValues?.minimumDispenseToCapture).toBe(5);
    expect(captured.body.isBillable).toBe(false);
    expect(captured.body.minimumDispenseToCapture).toBe(5);
  });

  it("still creates an item when the two fields are omitted (DB defaults apply)", async () => {
    const req = makeReq({
      code: "ITEM_DEFAULT_1",
      label: "Default Test Item",
    });
    const { res, captured } = makeRes();

    await dispatch(req, res);

    expect(captured.statusCode).toBe(201);
    expect(insertedValues).not.toBeNull();
    expect(insertedValues).not.toHaveProperty("isBillable");
    expect(insertedValues).not.toHaveProperty("minimumDispenseToCapture");
  });
});
