/**
 * The ROUTE half of the forced-return override, driven rather than grepped.
 *
 * tests/equipment-return-holder-guard.test.ts covers the SERVICE: the holder
 * check throws, and `allowForeignHolder: true` lets a foreign holder through.
 * What it could not cover is the route's own decision — who is allowed to set
 * `force`, what reaches the transaction, and what is written to the audit log —
 * and three cases there asserted only that tokens exist in the route's source
 * text. Source text cannot tell a working override from a deleted one.
 *
 * Hermetic: the equipment router imports cleanly with no database, so only the
 * custody service, the db transaction wrapper and the audit sink are mocked.
 * The terminal handler is invoked directly; the middleware chain in front of it
 * is covered by tests/equipment-non-uuid-id.routes.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

/** A thenable that answers every drizzle builder call with itself. */
function chainable(): Record<string, unknown> {
  const stub: Record<string, unknown> = {};
  const self = new Proxy(stub, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown[]) => unknown) => resolve([]);
      return () => self;
    },
  });
  return self;
}

const h = vi.hoisted(() => ({
  returnArgs: [] as Record<string, unknown>[],
  auditCalls: [] as Record<string, unknown>[],
  throwNotHolder: false,
}));

vi.mock("../server/lib/audit.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    logAudit: (entry: Record<string, unknown>) => {
      h.auditCalls.push(entry);
    },
  };
});

vi.mock("../server/services/equipment-custody-toggle.service.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // The real error class is kept, because the route branches on `instanceof`.
    performEquipmentReturn: async (_tx: unknown, params: Record<string, unknown>) => {
      h.returnArgs.push(params);
      if (h.throwNotHolder) {
        const Err = actual.CustodyReturnNotHolderError as new (m: string) => Error;
        throw new Err("held by someone else");
      }
      return {
        updated: { id: params.equipmentId, name: "Ventilator", clinicId: params.clinicId },
        undoToken: "undo-1",
        scanLogId: "scan-1",
        alreadyReturned: false,
        didTransitionCustody: true,
        waitlistPromotedOnReturn: null,
      };
    },
  };
});

vi.mock("../server/db.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      ...(actual.db as Record<string, unknown>),
      transaction: async (fn: (tx: unknown) => unknown) => fn({}),
      // Post-return side effects (reservation cleanup and friends) run against
      // the same handle. They are not what this file asserts, so they get a
      // chainable no-op rather than a database.
      delete: () => chainable(),
      insert: () => chainable(),
      update: () => chainable(),
      select: () => chainable(),
    },
  };
});

vi.mock("../server/lib/analytics-cache.js", () => ({ invalidateAnalyticsCache: vi.fn() }));
vi.mock("../server/lib/push.js", () => ({
  sendPushToAll: vi.fn(),
  sendPushToUser: vi.fn(),
  checkDedupe: () => true,
  shouldSendPilotEnglishEquipmentPush: () => false,
}));

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };

async function returnHandler() {
  const { default: router } = await import("../server/routes/equipment.js");
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find((l) => l.route?.path === "/:id/return" && l.route.methods.post === true);
  if (!layer?.route) throw new Error("POST /:id/return is not mounted on the equipment router");
  // The terminal handler is the last entry; everything before it is middleware.
  return layer.route.stack[layer.route.stack.length - 1].handle as (
    req: Request,
    res: Response,
  ) => Promise<unknown>;
}

function makeRes() {
  const captured: { statusCode: number; body: Record<string, unknown> } = { statusCode: 200, body: {} };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      return this;
    },
    setHeader() {
      return this;
    },
    getHeader() {
      return undefined;
    },
  } as unknown as Response;
  return { res, captured };
}

function makeReq(role: string, body: Record<string, unknown>) {
  return {
    params: { id: "eq-1" },
    body,
    query: {},
    headers: {},
    method: "POST",
    clinicId: "clinic-1",
    authUser: { id: "user-1", email: "u@clinic.test", role, secondaryRole: null },
  } as unknown as Request;
}

beforeEach(() => {
  h.returnArgs.length = 0;
  h.auditCalls.length = 0;
  h.throwNotHolder = false;
});

describe("POST /api/equipment/:id/return — who may force a foreign-holder return", () => {
  it("refuses a non-admin's forced return with 403 NOT_CURRENT_HOLDER", async () => {
    // A non-admin CAN send `force: true` — the route does not reject the field.
    // It resolves the override to false, so the service's holder check is what
    // stops it, and the route maps that to 403. Both halves matter: if the
    // route ever granted the override, `allowForeignHolder` below would be true
    // and no 403 would follow.
    h.throwNotHolder = true;
    const handler = await returnHandler();
    const { res, captured } = makeRes();

    await handler(makeReq("technician", { force: true }), res);

    expect(h.returnArgs).toHaveLength(1);
    expect(h.returnArgs[0].allowForeignHolder).toBe(false);
    expect(captured.statusCode).toBe(403);
    expect(captured.body.reason).toBe("NOT_CURRENT_HOLDER");
  });

  it("passes allowForeignHolder into the transaction for an admin, and audits it as forced", async () => {
    const handler = await returnHandler();
    const { res, captured } = makeRes();

    await handler(makeReq("admin", { force: true }), res);

    expect(h.returnArgs).toHaveLength(1);
    expect(h.returnArgs[0].allowForeignHolder).toBe(true);
    expect(captured.statusCode).toBe(200);

    // The override must not be invisible in the record.
    const forced = h.auditCalls.filter(
      (e) => (e.metadata as Record<string, unknown> | undefined)?.forcedByAdmin === true,
    );
    expect(forced).toHaveLength(1);
  });

  it("does not mark an ordinary admin return as forced", async () => {
    // Without `force`, an admin is an ordinary returner — no override, no
    // forcedByAdmin marker. This is what stops the audit flag from becoming a
    // synonym for "an admin did it".
    const handler = await returnHandler();
    const { res } = makeRes();

    await handler(makeReq("admin", {}), res);

    expect(h.returnArgs[0].allowForeignHolder).toBe(false);
    expect(
      h.auditCalls.filter((e) => (e.metadata as Record<string, unknown> | undefined)?.forcedByAdmin === true),
    ).toHaveLength(0);
  });
});
