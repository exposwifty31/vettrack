/**
 * Cross-tenant denial — focused behavioral regression test for P1 (audit G-1).
 *
 * Verifies that when a user authenticated to clinic B issues a PATCH against
 * a resource id that exists in clinic A, the handler returns 404 and the
 * response body contains no clinic A payload.
 *
 * Coverage:
 *   - PATCH /api/procurement/:id/submit  (vulnerable response-read path)
 *   - PATCH /api/alert-acks/:id/resolve  (vulnerable response-read path)
 *
 * Test fidelity note:
 *   The handlers do a clinic-scoped "existing row" lookup before the
 *   UPDATE, so a cross-tenant PATCH is rejected by that lookup before the
 *   patched trailing SELECT is ever reached. That means this test acts as
 *   a regression LOCK on the cross-tenant denial behavior, not as a
 *   failing-then-passing test of the trailing-read fix in isolation. The
 *   trailing-read fix is defense-in-depth: if a future refactor weakens
 *   the existing-row check, the clinicId filter on the response read
 *   becomes the second line of defense. A strict failing-then-passing
 *   assertion for that second line is structural (regex on .where bodies)
 *   and is intentionally out of scope for this P1 PR per the directive.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

// ─── drizzle-orm — pass-through predicate builders ─────────────────────────
// Real Drizzle predicates would require real column objects from the schema.
// The mocked db below ignores predicates, so we replace them with cheap
// inspectable values instead of real SQL builders.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  desc: (x: unknown) => x,
  inArray: (a: unknown, b: unknown) => ({ _type: "inArray", a, b }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
  // Tagged-template pass-through — server/routes/alert-acks.ts builds a
  // NULLIF(...) display-name column with sql`...` at module load time (T13).
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: "sql", strings, values }),
}));

// ─── db mock ───────────────────────────────────────────────────────────────
// Every .select(...).from(...).where(...).limit(...) resolves to []. That
// simulates "the requested id is not visible in the auth user's clinic" —
// exactly the cross-tenant scenario being tested.
const selectResolvesTo: unknown[] = [];

vi.mock("../server/db.js", () => {
  const fakeTable = new Proxy(
    {},
    {
      get: (_t, prop) => ({ _column: String(prop) }),
    },
  );
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    limit: () => selectResolvesTo,
    set: () => chain,
    values: () => chain,
    returning: async () => [],
  };
  return {
    db: {
      select: () => chain,
      update: () => chain,
      insert: () => chain,
      transaction: async (fn: (tx: typeof chain) => Promise<void>) => {
        await fn(chain);
      },
    },
    purchaseOrders: fakeTable,
    poLines: fakeTable,
    alertAcks: fakeTable,
    equipment: fakeTable,
    containerItems: fakeTable,
    inventoryLogs: fakeTable,
    inventoryItems: fakeTable,
    // alert-acks.ts joins vt_users (clinic-scoped) to serialize the actor
    // display name instead of the raw email (T13).
    users: fakeTable,
  };
});

// ─── audit mock — fire-and-forget no-op ────────────────────────────────────
vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

// ─── push mock — never fires in tests ──────────────────────────────────────
vi.mock("../server/lib/push.js", () => ({
  sendPushToOthers: vi.fn(async () => undefined),
  checkDedupe: () => true,
  shouldSendPilotEnglishEquipmentPush: () => true,
}));

// ─── auth middleware mock — pass-through for clinic B user ─────────────────
type TestAuthUser = { id: string; email: string; clinicId: string; role: string };

let currentAuthUser: TestAuthUser = {
  id: "user-clinic-b",
  email: "admin-b@test",
  clinicId: "clinic-b",
  role: "admin",
};

vi.mock("../server/middleware/auth.js", () => {
  const pass = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: TestAuthUser; clinicId?: string }).authUser =
      currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  };
  return {
    requireAuth: pass,
    requireAuthAny: pass,
    requireAdmin: pass,
    requireEffectiveRole: () => pass,
  };
});

// ─── validate middleware — pass-through (we supply valid shapes by hand) ───
vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) =>
    next(),
  validateUuid: () => (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

// ─── tiny req/res harness mirroring clinical-check-in.routes.test.ts ───────

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

function makeReq(options: {
  method: string;
  url: string;
  params?: Record<string, string>;
  body?: unknown;
}): Request {
  return {
    method: options.method,
    url: options.url,
    originalUrl: options.url,
    body: options.body ?? {},
    headers: {},
    params: options.params ?? {},
    query: {},
  } as unknown as Request;
}

async function dispatch(
  routerImportPath: string,
  req: Request,
  res: Response,
): Promise<void> {
  const { default: router } = await import(routerImportPath);
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
    setTimeout(finish, 500);
  });
}

beforeEach(() => {
  selectResolvesTo.length = 0; // every select resolves to []
  currentAuthUser = {
    id: "user-clinic-b",
    email: "admin-b@test",
    clinicId: "clinic-b",
    role: "admin",
  };
});

// ───────────────────────────────────────────────────────────────────────────
// Test fixtures: a clinic-A purchase order and a clinic-A alert ack that the
// clinic-B authenticated user will attempt to mutate.
// ───────────────────────────────────────────────────────────────────────────

const CLINIC_A_PO_ID = "11111111-1111-1111-1111-111111111111";
const CLINIC_A_PO_PAYLOAD_MARKER = "supplier-clinic-a"; // would appear in a leak
const CLINIC_A_ACK_ID = "22222222-2222-2222-2222-222222222222";
const CLINIC_A_ACK_PAYLOAD_MARKER = "equipment-clinic-a"; // would appear in a leak

describe("PATCH /api/procurement/:id/submit — clinic B cannot mutate clinic A's PO", () => {
  it("returns 404 and does not leak clinic A payload", async () => {
    const req = makeReq({
      method: "PATCH",
      url: `/${CLINIC_A_PO_ID}/submit`,
      params: { id: CLINIC_A_PO_ID },
    });
    const { res, captured } = makeRes();
    await dispatch("../server/routes/procurement.js", req, res);

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({
      code: "NOT_FOUND",
      reason: "PO_NOT_FOUND",
    });

    // Body must not contain anything that smells like clinic A's PO.
    const serialized = JSON.stringify(captured.body ?? {});
    expect(serialized).not.toContain(CLINIC_A_PO_PAYLOAD_MARKER);
    expect(serialized).not.toContain("clinic-a");
    expect(serialized).not.toContain("supplierName");
  });
});

describe("PATCH /api/alert-acks/:id/resolve — clinic B cannot mutate clinic A's ack", () => {
  it("returns 404 and does not leak clinic A payload", async () => {
    const req = makeReq({
      method: "PATCH",
      url: `/${CLINIC_A_ACK_ID}/resolve`,
      params: { id: CLINIC_A_ACK_ID },
      body: { resolutionNote: "attempting to resolve cross-tenant" },
    });
    const { res, captured } = makeRes();
    await dispatch("../server/routes/alert-acks.js", req, res);

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({
      code: "NOT_FOUND",
      reason: "ACK_NOT_FOUND",
    });

    const serialized = JSON.stringify(captured.body ?? {});
    expect(serialized).not.toContain(CLINIC_A_ACK_PAYLOAD_MARKER);
    expect(serialized).not.toContain("clinic-a");
    expect(serialized).not.toContain("equipmentId");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Structural assertion — locks the actual P1 remediation
// ───────────────────────────────────────────────────────────────────────────
//
// Why a separate structural check?
//   The behavioral test above is short-circuited by the clinic-scoped
//   existing-row check at the top of each handler. That check would return
//   404 even on the pre-fix code. To prove the trailing response read is
//   itself clinic-scoped (the actual P1 remediation), we assert it at the
//   source level: every .from(purchaseOrders) / .from(alertAcks) SELECT
//   whose .where(...) predicate references `<table>.id` must also reference
//   `<table>.clinicId` in the same predicate.
//
//   This assertion fails on the pre-fix pattern
//     .where(eq(purchaseOrders.id, req.params.id))
//   and passes on the post-fix pattern
//     .where(and(eq(purchaseOrders.clinicId, clinicId),
//                eq(purchaseOrders.id, req.params.id)))
//
//   Scope is limited to the two audited files; no helper, no cross-cutting
//   linter, no abstraction layer.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const procurementSrc = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "procurement.ts"),
  "utf8",
);
const alertAcksSrc = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "alert-acks.ts"),
  "utf8",
);

// Return the body of every .where(...) call that immediately follows a
// .from(<tableName>) chain in `src`. Scans for balanced parens so a
// .where(and(eq(...), eq(...))) call is captured as a single body.
function whereBodiesAfterFrom(src: string, tableName: string): string[] {
  const fromMarker = `.from(${tableName})`;
  const bodies: string[] = [];
  let cursor = 0;
  while (true) {
    const fromIdx = src.indexOf(fromMarker, cursor);
    if (fromIdx === -1) break;
    const whereIdx = src.indexOf(".where(", fromIdx);
    if (whereIdx === -1) {
      cursor = fromIdx + fromMarker.length;
      continue;
    }
    const openParen = whereIdx + ".where(".length;
    let depth = 1;
    let i = openParen;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    bodies.push(src.slice(openParen, i - 1));
    cursor = i;
  }
  return bodies;
}

describe("Structural — procurement.ts response reads filter by clinicId", () => {
  const whereBodies = whereBodiesAfterFrom(procurementSrc, "purchaseOrders");

  it("at least one purchaseOrders SELECT exists (sanity)", () => {
    expect(whereBodies.length).toBeGreaterThan(0);
  });

  it("every purchaseOrders SELECT that filters by id also filters by clinicId", () => {
    const violations: string[] = [];
    for (const body of whereBodies) {
      if (body.includes("purchaseOrders.id") && !body.includes("purchaseOrders.clinicId")) {
        violations.push(body.replace(/\s+/g, " ").slice(0, 200));
      }
    }
    expect(violations, `id-filtered SELECTs missing clinicId:\n  - ${violations.join("\n  - ")}`).toEqual([]);
  });
});

describe("Structural — alert-acks.ts response reads filter by clinicId", () => {
  const whereBodies = whereBodiesAfterFrom(alertAcksSrc, "alertAcks");

  it("at least one alertAcks SELECT exists (sanity)", () => {
    expect(whereBodies.length).toBeGreaterThan(0);
  });

  it("every alertAcks SELECT that filters by id also filters by clinicId", () => {
    const violations: string[] = [];
    for (const body of whereBodies) {
      if (body.includes("alertAcks.id") && !body.includes("alertAcks.clinicId")) {
        violations.push(body.replace(/\s+/g, " ").slice(0, 200));
      }
    }
    expect(violations, `id-filtered SELECTs missing clinicId:\n  - ${violations.join("\n  - ")}`).toEqual([]);
  });
});
