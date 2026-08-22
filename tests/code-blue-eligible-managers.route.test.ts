/**
 * `GET /api/code-blue/eligible-managers` — route contract.
 *
 * Drives the real Code Blue Express router (no supertest, no live server), the same
 * way tests/equipment-locate-route.test.ts drives its own. The discovery service is
 * mocked at its module boundary — its behaviour is covered by
 * tests/code-blue-eligible-managers.service.test.ts — so this file tests the wiring
 * that only the route can get wrong: the gate, the response envelope, and where the
 * clinic scope comes from.
 *
 * `requireClinicalUser` is deliberately NOT mocked. The 403 case below exercises the
 * production role set; a stubbed gate would assert nothing about who is admitted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import type { CodeBlueEligibleManager } from "@vettrack/contracts";

// ── auth: only requireAuth is replaced; the real clinical gate runs ──────────

type TestAuthUser = { id: string; name: string; email: string; clinicId: string; role: string };

let currentAuthUser: TestAuthUser | null = null;

vi.mock("../server/middleware/auth.js", async () => {
  const actual =
    await vi.importActual<typeof import("../server/middleware/auth.js")>(
      "../server/middleware/auth.js",
    );
  return {
    ...actual,
    requireAuth: (req: Request, res: Response, next: NextFunction) => {
      if (!currentAuthUser) {
        res.status(401).json({
          code: "UNAUTHORIZED",
          error: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId: "test-req",
        });
        return;
      }
      // The fixture carries only the fields this route reads (id, role,
      // clinicId); `authUser` is the full DB user row. Widening the fixture to
      // the real type would pin this suite to every unrelated column change.
      req.authUser = currentAuthUser as unknown as Request["authUser"];
      req.clinicId = currentAuthUser.clinicId;
      next();
    },
  };
});

// ── the discovery service, mocked at its boundary ───────────────────────────

/** Per-clinic rosters. If the route passes the wrong clinic, the body reveals it. */
const rosters: Record<string, CodeBlueEligibleManager[]> = {
  "clinic-a": [{ userId: "a-vet", name: "Alpha Vet", role: "vet" }],
  "clinic-b": [
    { userId: "b-vet", name: "Bravo Vet", role: "vet" },
    { userId: "b-admin", name: "Bravo Admin", role: "admin" },
  ],
};

const serviceCalls: Array<{ clinicId: string }> = [];
let serviceThrows = false;

vi.mock("../server/lib/authority/code-blue-eligible-managers.js", () => ({
  listCodeBlueEligibleManagers: async ({ clinicId }: { clinicId: string }) => {
    serviceCalls.push({ clinicId });
    if (serviceThrows) throw new Error("boom");
    return rosters[clinicId] ?? [];
  },
}));

// ── fake req / res ──────────────────────────────────────────────────────────

type Captured = { statusCode: number; body: Record<string, unknown>; responded: boolean };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: {}, responded: false };
  const headers = new Map<string, string>();
  const res = {
    locals: {},
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      captured.responded = true;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    // Express's Response has ~60 members; this double implements the four the
    // handler touches (status, json, setHeader, getHeader). A structural cast
    // would demand stubs for the rest, none of which this test exercises.
  } as unknown as Response;
  return { res, captured };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    url: "/eligible-managers",
    originalUrl: "/api/code-blue/eligible-managers",
    headers: {},
    params: {},
    query: {},
    ...overrides,
    // Same reason as the Response double above: Express's Request is far wider
    // than the handful of fields the route reads, and the extras are inert here.
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/code-blue.js");
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
    setTimeout(finish, 300);
  });
}

const CLINICAL_CALLER: TestAuthUser = {
  id: "u-tech",
  name: "Tess Tech",
  email: "tech@clinic.test",
  clinicId: "clinic-a",
  role: "technician",
};

beforeEach(() => {
  currentAuthUser = { ...CLINICAL_CALLER };
  serviceCalls.length = 0;
  serviceThrows = false;
});

describe("GET /api/code-blue/eligible-managers — gate", () => {
  it("401s an unauthenticated caller", async () => {
    currentAuthUser = null;
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);
    expect(captured.statusCode).toBe(401);
    expect(serviceCalls).toEqual([]);
  });

  it("403s a student — the one role the clinical gate excludes", async () => {
    currentAuthUser = { ...CLINICAL_CALLER, id: "u-student", role: "student" };
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);
    expect(captured.statusCode).toBe(403);
    expect(captured.body.reason ?? captured.body.code).toBe("INSUFFICIENT_ROLE");
    expect(serviceCalls).toEqual([]);
  });

  it("admits a technician — the picker is shown to whoever may open a Code Blue", async () => {
    // Narrowing this to vet/admin would leave a technician who is permitted to
    // START a Code Blue unable to SEE who may manage it. The list must not be
    // harder to reach than the mutation it feeds.
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);
    // `responded` guards against the vacuous pass: an unrouted request leaves the
    // default 200 in place, so status alone would prove nothing.
    expect(captured.responded).toBe(true);
    expect(captured.statusCode).toBe(200);
    expect(serviceCalls).toEqual([{ clinicId: "clinic-a" }]);
  });

  it.each(["vet", "admin", "senior_technician"])("admits a %s", async (role) => {
    currentAuthUser = { ...CLINICAL_CALLER, role };
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);
    expect(captured.responded).toBe(true);
    expect(captured.statusCode).toBe(200);
  });
});

describe("GET /api/code-blue/eligible-managers — response", () => {
  it("returns the clinic's eligible managers under `managers`", async () => {
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({
      managers: [{ userId: "a-vet", name: "Alpha Vet", role: "vet" }],
    });
  });

  it("returns an empty list, not an error, when no one is eligible", async () => {
    // Mid-arrest an empty picker is a real answer ("nobody on shift qualifies").
    // A 404 or 500 here would be read as a bug and retried.
    currentAuthUser = { ...CLINICAL_CALLER, clinicId: "clinic-empty" };
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({ managers: [] });
  });

  it("500s with a stable envelope when the service throws", async () => {
    serviceThrows = true;
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);

    expect(captured.statusCode).toBe(500);
    expect(captured.body.code).toBe("INTERNAL_ERROR");
  });
});

describe("GET /api/code-blue/eligible-managers — cross-tenant isolation", () => {
  it("a clinic-A caller cannot see clinic B's eligible managers", async () => {
    currentAuthUser = { ...CLINICAL_CALLER, clinicId: "clinic-a" };
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);

    const names = (captured.body.managers as CodeBlueEligibleManager[]).map((m) => m.name);
    expect(names).toEqual(["Alpha Vet"]);
    expect(names).not.toContain("Bravo Vet");
    expect(names).not.toContain("Bravo Admin");
    expect(serviceCalls).toEqual([{ clinicId: "clinic-a" }]);
  });

  it("a clinic-B caller gets clinic B, proving the scope is the caller's own", async () => {
    // Without this pair, a route hardcoding "clinic-a" would pass the test above.
    currentAuthUser = { ...CLINICAL_CALLER, clinicId: "clinic-b" };
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);

    const names = (captured.body.managers as CodeBlueEligibleManager[]).map((m) => m.name);
    expect(names).toEqual(["Bravo Vet", "Bravo Admin"]);
    expect(serviceCalls).toEqual([{ clinicId: "clinic-b" }]);
  });

  it("ignores a client-supplied clinic — scope comes from the session only", async () => {
    currentAuthUser = { ...CLINICAL_CALLER, clinicId: "clinic-a" };
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({
        query: { clinicId: "clinic-b" } as Request["query"],
        headers: { "x-clinic-id": "clinic-b" } as Request["headers"],
      }),
      res,
    );

    expect(serviceCalls).toEqual([{ clinicId: "clinic-a" }]);
    expect((captured.body.managers as CodeBlueEligibleManager[]).map((m) => m.name)).toEqual([
      "Alpha Vet",
    ]);
  });
});
