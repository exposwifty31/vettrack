/**
 * G4-2 — native-token ownership transfer audit (CodeRabbit PR #173 round-2 #3).
 *
 * POST /api/push/subscribe (native branch) replaces any existing (clinicId, token)
 * row so a shared device re-registered by a different user does not 500 on the
 * unique index. When that replacement moves a token from one user to another in
 * the SAME clinic it is an ownership transfer and must be audited
 * (`push_token_reassigned`, fire-and-forget after commit). A same-user
 * re-register is NOT a transfer and must NOT audit.
 *
 * Drives the Express Router directly (no supertest); auth, validation, rate
 * limiters, db, audit, and the push lib are mocked at their module boundaries.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

type TestAuthUser = { id: string; email: string; clinicId: string; role: string };
let currentAuthUser: TestAuthUser = {
  id: "user-new",
  email: "new@clinic.test",
  clinicId: "clinic-1",
  role: "vet",
};

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
}));

vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/middleware/rate-limiters.js", () => ({
  authSensitiveLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  pushTestLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _t: "and", a }),
  eq: (a: unknown, b: unknown) => ({ _t: "eq", a, b }),
  isNull: (x: unknown) => ({ _t: "isNull", x }),
}));

// The push lib is stubbed so importing the route never loads real transports.
vi.mock("../server/lib/push.js", () => ({
  sendPushToUser: vi.fn(),
  getVapidPublicKey: vi.fn(),
  isVapidReady: () => false,
  isPushReady: () => false,
  whenPushInitialized: vi.fn(() => Promise.resolve()),
}));

const logAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit,
  resolveAuditActorRole: () => "vet",
}));

// db.transaction runs the callback against a tx whose SELECT returns the
// configured existing row for (clinicId, token); delete + insert resolve. When
// `transactionRejects` is set, the transaction REJECTS — modelling a persistence
// failure so the handler's catch path (500 PUSH_SUBSCRIBE_SAVE_FAILED, no audit)
// can be exercised.
let existingRows: Array<{ userId: string }> = [];
let transactionRejects = false;
vi.mock("../server/db.js", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(existingRows) }) }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "new-sub-id" }]) }) }),
  };
  return {
    db: {
      transaction: (cb: (t: typeof tx) => unknown) =>
        transactionRejects ? Promise.reject(new Error("db write failed")) : Promise.resolve(cb(tx)),
    },
    pool: {},
    pushSubscriptions: new Proxy({}, { get: (_t, p) => ({ _column: String(p) }) }),
  };
});

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
    send() {
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
    url: "/subscribe",
    originalUrl: "/api/push/subscribe",
    headers: {},
    params: {},
    query: {},
    body,
  } as unknown as Request;
}

async function dispatchSubscribe(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { default: router } = await import("../server/routes/push.js");
  const req = makeReq(body);
  const { res, captured } = makeRes();
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
    router(req, res, () => finish());
    setTimeout(finish, 200);
  });
  // Let the post-commit fire-and-forget audit run.
  await new Promise<void>((r) => setTimeout(r, 0));
  return captured.body;
}

const NATIVE_BODY = { platform: "ios", token: "IOSTOKEN", soundEnabled: true, alertsEnabled: true };

describe("POST /api/push/subscribe — native-token ownership transfer audit", () => {
  beforeEach(() => {
    logAudit.mockClear();
    existingRows = [];
    transactionRejects = false;
    currentAuthUser = { id: "user-new", email: "new@clinic.test", clinicId: "clinic-1", role: "vet" };
  });

  it("audits push_token_reassigned when a same-clinic token is re-registered by a different user", async () => {
    existingRows = [{ userId: "user-old" }];
    const body = await dispatchSubscribe(NATIVE_BODY);
    expect(body).toEqual({ success: true });
    expect(logAudit).toHaveBeenCalledTimes(1);
    const params = logAudit.mock.calls[0][0];
    expect(params.actionType).toBe("push_token_reassigned");
    expect(params.clinicId).toBe("clinic-1");
    expect(params.performedBy).toBe("user-new");
    expect(params.metadata).toMatchObject({ previousUserId: "user-old", platform: "ios" });
    // The device token is a secret — it must never be written to the audit row.
    expect(JSON.stringify(params)).not.toContain("IOSTOKEN");
  });

  it("does NOT audit when the same user re-registers the same token", async () => {
    existingRows = [{ userId: "user-new" }];
    const body = await dispatchSubscribe(NATIVE_BODY);
    expect(body).toEqual({ success: true });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does NOT audit a brand-new token registration (no prior owner)", async () => {
    existingRows = [];
    const body = await dispatchSubscribe(NATIVE_BODY);
    expect(body).toEqual({ success: true });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("returns PUSH_SUBSCRIBE_SAVE_FAILED and does NOT audit when persistence fails", async () => {
    // A prior owner IS present, so a successful commit WOULD audit the transfer —
    // but the transaction rejects. The ownership-transfer audit fires only after a
    // committed write, so a failed persist must skip it: no audit, 500 with the
    // save-failed reason code.
    existingRows = [{ userId: "user-old" }];
    transactionRejects = true;
    const body = await dispatchSubscribe(NATIVE_BODY);
    expect(body.reason).toBe("PUSH_SUBSCRIBE_SAVE_FAILED");
    expect(logAudit).not.toHaveBeenCalled();
  });
});
