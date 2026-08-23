/**
 * Unit tests for POST /api/inventory-items — duplicate-key classification.
 *
 * Drives the Express Router directly (no supertest, no live server), mirroring
 * tests/equipment-locate-route.test.ts. Auth/validation/audit are mocked; the
 * db insert is mocked to throw Postgres-shaped unique-violation errors so the
 * test can assert the route distinguishes a duplicate `code` from a duplicate
 * `nfc_tag_id` instead of collapsing every 23505 into CODE_EXISTS.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { ITEM_CODE_UNIQUE_CONSTRAINT, ITEM_NFC_TAG_UNIQUE_CONSTRAINT } from "../server/lib/pg-errors.js";

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = {
      id: "user-admin",
      email: "admin@clinic.test",
      clinicId: "clinic-1",
      role: "admin",
    };
    (req as Request & { clinicId?: string }).clinicId = "clinic-1";
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireEffectiveRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: () => {},
  resolveAuditActorRole: () => "admin",
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  asc: (x: unknown) => ({ _type: "asc", x }),
  desc: (x: unknown) => ({ _type: "desc", x }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: "sql", strings, values }),
}));

let insertShouldThrow: unknown = null;
const insertedRow = { id: "item-1", clinicId: "clinic-1", code: "ABC" };

vi.mock("../server/db.js", () => ({
  db: {
    insert: () => ({
      values: async () => {
        if (insertShouldThrow) throw insertShouldThrow;
        return undefined;
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([insertedRow]),
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

// The router only ever calls status/json/setHeader/getHeader on `res` and
// reads method/url/originalUrl/headers/params/body/locale off `req` — a full
// Express Request/Response would need dozens of unused members stubbed out
// for no benefit, so these fixtures implement only what's exercised and cast
// through `unknown` (same convention as tests/equipment-locate-route.test.ts).
function makeRes(): { res: Response; captured: { statusCode: number; body: Record<string, unknown> } } {
  const captured = { statusCode: 200, body: {} as Record<string, unknown> };
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

function makeReq(body: Record<string, unknown>, locale: "en" | "he" = "en"): Request {
  return {
    method: "POST",
    url: "/",
    originalUrl: "/api/inventory-items",
    headers: {},
    params: {},
    body,
    locale,
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
    const origJson = (res as Response).json.bind(res);
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

const validBody = { code: "abc", label: "Gauze", itemType: "CONSUMABLE" as const };

beforeEach(() => {
  insertShouldThrow = null;
});

describe("POST /api/inventory-items", () => {
  it("creates the item when there is no conflict", async () => {
    const { res, captured } = makeRes();
    await dispatch(makeReq(validBody), res);
    expect(captured.statusCode).toBe(201);
  });

  it("returns 409 CODE_EXISTS on a duplicate (clinicId, code)", async () => {
    insertShouldThrow = { code: "23505", constraint: ITEM_CODE_UNIQUE_CONSTRAINT };
    const { res, captured } = makeRes();
    await dispatch(makeReq(validBody), res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body.reason).toBe("CODE_EXISTS");
  });

  it("returns a distinct 409 NFC_TAG_EXISTS on a duplicate nfc_tag_id, not CODE_EXISTS", async () => {
    insertShouldThrow = { code: "23505", constraint: ITEM_NFC_TAG_UNIQUE_CONSTRAINT };
    const { res, captured } = makeRes();
    await dispatch(makeReq({ ...validBody, nfcTagId: "tag-1" }, "en"), res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body.reason).toBe("NFC_TAG_EXISTS");
    expect(captured.body.message).toBe("This NFC tag is already assigned to another item");
  });

  it("localizes the NFC conflict message to the request locale instead of hardcoding English", async () => {
    insertShouldThrow = { code: "23505", constraint: ITEM_NFC_TAG_UNIQUE_CONSTRAINT };
    const { res, captured } = makeRes();
    await dispatch(makeReq({ ...validBody, nfcTagId: "tag-1" }, "he"), res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body.message).toBe("תג ה-NFC הזה כבר משויך לפריט אחר");
  });

  it("falls through to 500 for an unrelated constraint violation instead of misreporting CODE_EXISTS", async () => {
    insertShouldThrow = { code: "23505", constraint: "some_other_table_unique" };
    const { res, captured } = makeRes();
    await dispatch(makeReq(validBody), res);
    expect(captured.statusCode).toBe(500);
  });
});
