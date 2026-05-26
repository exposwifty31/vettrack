/**
 * Admin outbox DLQ — list / retry / drop route tests (mocked auth + db).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { parseDlqListLimit } from "../server/routes/admin-outbox-dlq.js";

let currentAuthUser:
  | { id: string; email: string; clinicId: string; role: string }
  | null = {
  id: "admin-1",
  email: "admin@clinic.test",
  clinicId: "clinic-a",
  role: "admin",
};

vi.mock("../server/middleware/auth.js", () => ({
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
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { authUser?: { role?: string } }).authUser;
    if (user?.role !== "admin") {
      res.status(403).json({
        code: "FORBIDDEN",
        error: "FORBIDDEN",
        reason: "INSUFFICIENT_ROLE",
        message: "Admin role required",
        requestId: "test-req",
      });
      return;
    }
    next();
  },
}));

const mockLogAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
  resolveAuditActorRole: () => "admin",
}));

let selectRows: unknown[] = [];
let countPermanent = 0;
let updateReturning: { id: number }[] = [];
let deleteReturning: { id: number }[] = [];

const fluent: Record<string, unknown> = {};
function rec(method: string) {
  return (...args: unknown[]) => {
    dbCalls.push({ method, args });
    return fluent;
  };
}
const dbCalls: { method: string; args: unknown[] }[] = [];
for (const m of ["from", "where", "orderBy", "limit", "set", "returning"]) {
  fluent[m] = rec(m);
}
(fluent as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
  const last = dbCalls[dbCalls.length - 1]?.method;
  if (last === "returning") {
    return resolve(updateReturning.length > 0 ? updateReturning : deleteReturning);
  }
  const hasOrderBy = dbCalls.some((c) => c.method === "orderBy");
  if (last === "limit" || hasOrderBy) {
    return resolve(selectRows);
  }
  if (last === "where" || last === "from") {
    return resolve([{ n: countPermanent }]);
  }
  return resolve([]);
};

vi.mock("../server/db.js", () => ({
  db: {
    select: () => fluent,
    update: () => fluent,
    delete: () => fluent,
  },
  eventOutbox: {
    id: "eventOutbox.id",
    clinicId: "eventOutbox.clinicId",
    type: "eventOutbox.type",
    occurredAt: "eventOutbox.occurredAt",
    retryCount: "eventOutbox.retryCount",
    errorType: "eventOutbox.errorType",
    lastAttemptAt: "eventOutbox.lastAttemptAt",
    nextAttemptAt: "eventOutbox.nextAttemptAt",
    publishedAt: "eventOutbox.publishedAt",
  },
}));

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
    headersSent: false,
  } as unknown as Response;
  return { res, captured };
}

function makeReq(options: {
  method: string;
  url: string;
  body?: unknown;
  query?: Record<string, string>;
}): Request {
  return {
    method: options.method,
    url: options.url,
    originalUrl: options.url,
    body: options.body ?? {},
    headers: {},
    params: {},
    query: options.query ?? {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/admin-outbox-dlq.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      origJson(payload);
      setImmediate(finish);
      return res;
    };
    router(req, res, (err?: unknown) => {
      if (err) console.error("router next error:", err);
      finish();
    });
  });
}

describe("parseDlqListLimit", () => {
  it("defaults to 50", () => {
    expect(parseDlqListLimit(undefined)).toEqual({ ok: true, limit: 50 });
  });

  it("rejects invalid limit", () => {
    expect(parseDlqListLimit("abc").ok).toBe(false);
    expect(parseDlqListLimit("0").ok).toBe(false);
    expect(parseDlqListLimit("201").ok).toBe(false);
  });
});

describe("admin outbox DLQ routes", () => {
  beforeEach(() => {
    dbCalls.length = 0;
    selectRows = [];
    countPermanent = 0;
    updateReturning = [];
    deleteReturning = [];
    mockLogAudit.mockClear();
    currentAuthUser = {
      id: "admin-1",
      email: "admin@clinic.test",
      clinicId: "clinic-a",
      role: "admin",
    };
  });

  it("GET /outbox/dlq denies non-admin", async () => {
    currentAuthUser = {
      id: "tech-1",
      email: "tech@clinic.test",
      clinicId: "clinic-a",
      role: "technician",
    };
    const { res, captured } = makeRes();
    await dispatch(makeReq({ method: "GET", url: "/outbox/dlq" }), res);
    expect(captured.statusCode).toBe(403);
  });

  it("GET /outbox/dlq returns clinic-scoped items", async () => {
    selectRows = [
      {
        id: 99,
        type: "audit_log",
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        retryCount: 4,
        errorType: "transient",
        lastAttemptAt: new Date("2026-01-01T01:00:00Z"),
        nextAttemptAt: null,
      },
    ];
    const { res, captured } = makeRes();
    await dispatch(makeReq({ method: "GET", url: "/outbox/dlq" }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { clinicId: string; items: { id: number }[] };
    expect(body.clinicId).toBe("clinic-a");
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe(99);
    expect(dbCalls.some((c) => c.method === "where")).toBe(true);
  });

  it("GET /outbox/dlq rejects invalid limit query", async () => {
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({ method: "GET", url: "/outbox/dlq", query: { limit: "0" } }),
      res,
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { code: string };
    expect(body.code).toBe("INVALID_QUERY");
  });

  it("GET /outbox/dlq uses different clinic from auth user (tenancy via clinicId)", async () => {
    currentAuthUser = {
      id: "admin-b",
      email: "admin@clinic-b.test",
      clinicId: "clinic-b",
      role: "admin",
    };
    selectRows = [];
    const { res, captured } = makeRes();
    await dispatch(makeReq({ method: "GET", url: "/outbox/dlq" }), res);
    expect(captured.statusCode).toBe(200);
    expect((captured.body as { clinicId: string }).clinicId).toBe("clinic-b");
  });

  it("POST /outbox/dlq/retry blocks permanent without force", async () => {
    countPermanent = 2;
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/outbox/dlq/retry", body: {} }),
      res,
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { code: string };
    expect(body.code).toBe("PERMANENT_DLQ_REQUIRES_FORCE");
  });

  it("POST /outbox/dlq/retry allows force and audits", async () => {
    countPermanent = 1;
    updateReturning = [{ id: 1 }, { id: 2 }];
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/outbox/dlq/retry", body: { force: true } }),
      res,
    );
    expect(captured.statusCode).toBe(200);
    expect((captured.body as { resetCount: number }).resetCount).toBe(2);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "outbox_dlq_retry_all", clinicId: "clinic-a" }),
    );
  });

  it("POST /outbox/dlq/drop requires admin and audits", async () => {
    deleteReturning = [{ id: 5 }];
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/outbox/dlq/drop", body: { ids: [5, 9] } }),
      res,
    );
    expect(captured.statusCode).toBe(200);
    expect((captured.body as { deletedCount: number }).deletedCount).toBe(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "outbox_dlq_drop", clinicId: "clinic-a" }),
    );
  });

  it("POST /outbox/dlq/drop denies technician", async () => {
    currentAuthUser = {
      id: "tech-1",
      email: "tech@clinic.test",
      clinicId: "clinic-a",
      role: "technician",
    };
    const { res, captured } = makeRes();
    await dispatch(
      makeReq({ method: "POST", url: "/outbox/dlq/drop", body: { ids: [1] } }),
      res,
    );
    expect(captured.statusCode).toBe(403);
  });
});
