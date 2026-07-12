/**
 * Unit tests for POST /api/equipment/:id/damage (T-24b · R-EQ-F3 · small-04).
 *
 * Drives the Express Router directly (no supertest, no live server), mirroring
 * tests/equipment-locate-route.test.ts. Auth + rate limiter + drizzle-orm
 * predicate builders + the db module + logAudit are mocked at their module
 * boundaries so this test focuses on route wiring: clinicId scoping (never
 * from request input), the damage-event insert + conditionStatus flip inside
 * one transaction, and the fire-and-forget audit call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

// ── Auth mock ────────────────────────────────────────────────────────────────

type TestAuthUser = { id: string; email: string; clinicId: string; role: string };

let currentAuthUser: TestAuthUser | null = {
  id: "user-vet",
  email: "vet@clinic.test",
  clinicId: "clinic-1",
  role: "vet",
};

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        error: "UNAUTHORIZED",
        reason: "UNAUTHORIZED",
        message: "Unauthorized",
        requestId: "test-req",
      });
      return;
    }
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
}));

// ── Rate limiter mock — pass-through no-op (write limiter) ───────────────────
vi.mock("../server/middleware/rate-limiters.js", () => ({
  writeLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── drizzle-orm — pass-through predicate builders (mocked db ignores them) ───
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: "sql", strings, values }),
}));

// ── audit mock ────────────────────────────────────────────────────────────────
type AuditCall = { actionType: string; clinicId: string; targetId?: string | null; metadata?: unknown };
let loggedAuditCalls: AuditCall[] = [];

vi.mock("../server/lib/audit.js", () => ({
  logAudit: (params: AuditCall) => {
    loggedAuditCalls.push(params);
  },
  resolveAuditActorRole: () => null,
}));

// ── DB mock — equipment lookup + transactional insert/update ────────────────
let selectResolvesTo: Array<{ id: string }> = [];
let insertedDamageEvents: Array<Record<string, unknown>> = [];
let equipmentUpdates: Array<Record<string, unknown>> = [];
let equipmentUpdateWherePredicates: unknown[] = [];

vi.mock("../server/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResolvesTo),
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            insertedDamageEvents.push(v);
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            equipmentUpdates.push(v);
            return {
              where: (predicate: unknown) => {
                equipmentUpdateWherePredicates.push(predicate);
                return Promise.resolve();
              },
            };
          },
        }),
      };
      await cb(tx);
    },
  },
  equipment: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
  damageEvents: new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) }),
}));

// ── Fake req/res helpers ──────────────────────────────────────────────────────

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

function makeReq(params: Record<string, string>, body: Record<string, unknown> = {}): Request {
  return {
    method: "POST",
    url: `/${params.id}/damage`,
    originalUrl: `/api/equipment/${params.id}/damage`,
    headers: {},
    params,
    query: {},
    body,
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/equipment-damage.js");
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
  currentAuthUser = {
    id: "user-vet",
    email: "vet@clinic.test",
    clinicId: "clinic-1",
    role: "vet",
  };
  selectResolvesTo = [];
  insertedDamageEvents = [];
  equipmentUpdates = [];
  equipmentUpdateWherePredicates = [];
  loggedAuditCalls = [];
});

describe("POST /api/equipment/:id/damage — auth", () => {
  it("returns 401 when no auth user", async () => {
    currentAuthUser = null;
    const req = makeReq({ id: "eq-1" }, { note: "Cracked screen" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(401);
    expect(insertedDamageEvents).toHaveLength(0);
  });
});

describe("POST /api/equipment/:id/damage — reporting damage (R-EQ-F3)", () => {
  it("persists the damage event and flips conditionStatus to a non-ok value", async () => {
    selectResolvesTo = [{ id: "eq-1" }];

    const req = makeReq({ id: "eq-1" }, { note: "Cracked screen" });
    const { res, captured } = makeRes();
    await dispatch(req, res);

    expect(captured.statusCode).toBe(201);

    expect(insertedDamageEvents).toHaveLength(1);
    expect(insertedDamageEvents[0]).toMatchObject({
      clinicId: "clinic-1",
      equipmentId: "eq-1",
      reportedBy: "user-vet",
      note: "Cracked screen",
    });

    expect(equipmentUpdates).toHaveLength(1);
    expect(equipmentUpdates[0].conditionStatus).not.toBe("ok");
    expect(typeof equipmentUpdates[0].conditionStatus).toBe("string");
    expect((equipmentUpdates[0].conditionStatus as string).length).toBeGreaterThan(0);
    // R-EQ-F3 review fix: bump optimistic-lock version and re-guard against a
    // soft-delete race, matching every other equipment-mutating route.
    expect(equipmentUpdates[0].version).toMatchObject({ _type: "sql" });
    expect(equipmentUpdateWherePredicates).toHaveLength(1);
    expect(JSON.stringify(equipmentUpdateWherePredicates[0])).toContain("isNull");

    expect(loggedAuditCalls).toHaveLength(1);
    expect(loggedAuditCalls[0]).toMatchObject({
      actionType: "equipment_damage_reported",
      clinicId: "clinic-1",
      targetId: "eq-1",
    });
  });

  it("rejects a cross-clinic write (equipment not found under this clinic's scope)", async () => {
    // Simulates the clinicId-scoped WHERE clause excluding equipment that
    // belongs to a different clinic, even though the id is well-formed.
    selectResolvesTo = [];

    const req = makeReq({ id: "eq-other-clinic" }, { note: "Cracked screen" });
    const { res, captured } = makeRes();
    await dispatch(req, res);

    expect(captured.statusCode).toBe(404);
    expect(insertedDamageEvents).toHaveLength(0);
    expect(equipmentUpdates).toHaveLength(0);
    expect(loggedAuditCalls).toHaveLength(0);
  });
});
