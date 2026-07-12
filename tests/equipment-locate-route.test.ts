/**
 * Unit tests for GET /api/equipment/locate (T-22a · R-EQ-F1 · small-01).
 *
 * Drives the Express Router directly (no supertest, no live server), mirroring
 * tests/clinical-check-in.routes.test.ts. Auth + rate limiter + the equipment
 * search query are mocked; the evidence-graph loader is mocked at its module
 * boundary (its own DB behavior is already covered by
 * tests/asset-copilot/resolver-golden.test.ts via buildSyntheticEvidenceGraph)
 * so this test focuses on route wiring: search matching, clinicId scoping,
 * and composing the real resolveCurrentLocation / resolveCustodian resolvers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { buildSyntheticEvidenceGraph } from "../server/domain/equipment/evidence/graph.loader.js";
import type { EvidenceGraph } from "../server/domain/equipment/evidence/graph.types.js";

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

// ── Rate limiter mock — pass-through no-op (scan/action limiter) ─────────────
vi.mock("../server/middleware/rate-limiters.js", () => ({
  scanLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── drizzle-orm — pass-through predicate builders (mocked db ignores them) ───
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  or: (...args: unknown[]) => ({ _type: "or", args }),
  ilike: (a: unknown, b: unknown) => ({ _type: "ilike", a, b }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
}));

// ── DB mock — equipment search query only ────────────────────────────────────
// The test controls what the clinicId-scoped search resolves to per scenario
// (same convention as tests/cross-tenant-denial.test.ts).
let searchResolvesTo: Array<{ id: string; name: string }> = [];

vi.mock("../server/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(searchResolvesTo),
        }),
      }),
    }),
  },
  equipment: new Proxy(
    {},
    { get: (_t, prop) => ({ _column: String(prop) }) },
  ),
}));

// ── Evidence graph loader — mocked at its module boundary ────────────────────
const graphs: Record<string, EvidenceGraph> = {};

vi.mock("../server/domain/equipment/evidence/graph.loader.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/domain/equipment/evidence/graph.loader.js")>();
  return {
    ...actual,
    loadEvidenceGraph: async ({ equipmentId }: { equipmentId: string }) => {
      const g = graphs[equipmentId];
      if (!g) throw new Error(`no synthetic graph registered for ${equipmentId}`);
      return g;
    },
  };
});

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

function makeReq(query: Record<string, string>): Request {
  return {
    method: "GET",
    url: "/locate",
    originalUrl: "/api/equipment/locate",
    headers: {},
    params: {},
    query,
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/equipment-locate.js");
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

const NOW = new Date("2026-07-01T10:00:00Z");

function baseEquipmentRow(
  overrides: Partial<NonNullable<EvidenceGraph["equipment"]>> = {},
): NonNullable<EvidenceGraph["equipment"]> {
  return {
    id: "eq-1",
    clinicId: "clinic-1",
    name: "Infusion Pump A",
    custodyState: "untracked",
    custodyStateSince: null,
    checkedOutById: null,
    checkedOutByEmail: null,
    checkedOutAt: null,
    checkedOutLocation: null,
    readinessState: "ready",
    usageState: "available",
    assetTypeId: null,
    roomId: null,
    dockId: null,
    location: null,
    lastRfidSeenAt: null,
    lastRfidRoomId: null,
    lastSeen: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentAuthUser = {
    id: "user-vet",
    email: "vet@clinic.test",
    clinicId: "clinic-1",
    role: "vet",
  };
  searchResolvesTo = [];
  for (const key of Object.keys(graphs)) delete graphs[key];
});

describe("GET /api/equipment/locate — auth + validation", () => {
  it("returns 401 when no auth user", async () => {
    currentAuthUser = null;
    const req = makeReq({ q: "pump" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(401);
  });

  it("returns 400 when q is missing", async () => {
    const req = makeReq({});
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
  });
});

describe("GET /api/equipment/locate — matching device (R-EQ-F1)", () => {
  it("returns the matching device's room (location) + custodian", async () => {
    searchResolvesTo = [{ id: "eq-1", name: "Infusion Pump A" }];
    graphs["eq-1"] = buildSyntheticEvidenceGraph({
      clinicId: "clinic-1",
      equipmentId: "eq-1",
      loadedAt: NOW,
      equipment: baseEquipmentRow({
        custodyState: "checked_out",
        custodyStateSince: new Date(NOW.getTime() - 5 * 60_000),
        checkedOutById: "user-9",
        checkedOutByEmail: "tech@vet.test",
        checkedOutAt: new Date(NOW.getTime() - 5 * 60_000),
        roomId: "room-1",
      }),
      rooms: [{ id: "room-1", clinicId: "clinic-1", name: "ICU Bay 3" }],
    });

    const req = makeReq({ q: "pump" });
    const { res, captured } = makeRes();
    await dispatch(req, res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as { results: Array<Record<string, unknown>> };
    expect(body.results).toHaveLength(1);
    const [match] = body.results;
    expect(match.equipmentId).toBe("eq-1");
    expect((match.location as { summary: string }).summary).toBe("room:ICU Bay 3");
    const custodianClaims = (
      match.custodian as { claims: Array<{ key: string; value: string }> }
    ).claims;
    expect(custodianClaims.find((c) => c.key === "custodian")?.value).toBe("tech@vet.test");
    expect(match.readiness).toBe("ready");
  });

  it("returns nothing for a cross-clinic device", async () => {
    // Simulates the clinicId-scoped WHERE clause excluding a device that
    // belongs to a different clinic even though its name matches `q`.
    searchResolvesTo = [];

    const req = makeReq({ q: "pump" });
    const { res, captured } = makeRes();
    await dispatch(req, res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as { results: Array<Record<string, unknown>> };
    expect(body.results).toEqual([]);
  });
});
