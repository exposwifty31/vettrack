/**
 * T13 (HIGH audit fix, privacy) — GET /api/alert-acks used to return only
 * acknowledgedByEmail; the alerts page rendered the email local-part as the
 * claim-chip actor label. The route now joins vt_users (clinic-scoped) and
 * serializes acknowledgedByDisplayName so the client never has to derive an
 * identity label from the email. These tests lock the wiring: the users join
 * is present, clinicId scoping survives it, and the response carries the
 * display-name field alongside (not instead of) the raw email column.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

let currentAuthUser:
  | { id: string; email: string; name: string; clinicId: string; role: string }
  | null = {
  id: "tech-1",
  email: "tech@clinic.test",
  name: "Tech One",
  clinicId: "clinic-a",
  role: "senior_technician",
};

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({ code: "UNAUTHORIZED", error: "UNAUTHORIZED" });
      return;
    }
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
  requireEffectiveRole: () => (req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "senior_technician",
}));

vi.mock("../server/lib/push.js", () => ({
  sendPushToOthers: vi.fn(async () => {}),
  checkDedupe: () => false,
}));

let selectRows: unknown[] = [];
const dbCalls: { method: string; args: unknown[] }[] = [];
const fluent: Record<string, unknown> = {};
function rec(method: string) {
  return (...args: unknown[]) => {
    dbCalls.push({ method, args });
    return fluent;
  };
}
for (const m of ["from", "leftJoin", "where", "orderBy", "limit", "set", "values", "returning"]) {
  fluent[m] = rec(m);
}
(fluent as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(selectRows);

vi.mock("../server/db.js", () => ({
  db: {
    select: (...args: unknown[]) => {
      dbCalls.push({ method: "select", args });
      return fluent;
    },
    insert: () => fluent,
    update: () => fluent,
  },
  alertAcks: {
    id: "alertAcks.id",
    clinicId: "alertAcks.clinicId",
    equipmentId: "alertAcks.equipmentId",
    alertType: "alertAcks.alertType",
    acknowledgedById: "alertAcks.acknowledgedById",
    acknowledgedByEmail: "alertAcks.acknowledgedByEmail",
    acknowledgedAt: "alertAcks.acknowledgedAt",
    remindAt: "alertAcks.remindAt",
    remindedAt: "alertAcks.remindedAt",
    ackStatus: "alertAcks.ackStatus",
    resolvedAt: "alertAcks.resolvedAt",
    resolvedById: "alertAcks.resolvedById",
    resolutionNote: "alertAcks.resolutionNote",
  },
  equipment: { id: "equipment.id" },
  users: { id: "users.id", clinicId: "users.clinicId", name: "users.name" },
}));

type Captured = { statusCode: number; body: unknown };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    },
    headersSent: false,
  } as unknown as Response;
  return { res, captured };
}

function makeReq(options: {
  method: string;
  url: string;
  query?: Record<string, string>;
}): Request {
  return {
    method: options.method,
    url: options.url,
    originalUrl: options.url,
    body: {},
    headers: {},
    params: {},
    query: options.query ?? {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/alert-acks.js");
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

describe("GET /api/alert-acks — serializes displayName, joins vt_users (T13)", () => {
  beforeEach(() => {
    dbCalls.length = 0;
    selectRows = [];
    currentAuthUser = {
      id: "tech-1",
      email: "tech@clinic.test",
      name: "Tech One",
      clinicId: "clinic-a",
      role: "senior_technician",
    };
  });

  it("joins vt_users so the response carries acknowledgedByDisplayName", async () => {
    selectRows = [
      {
        id: "ack-1",
        clinicId: "clinic-a",
        equipmentId: "eq-1",
        alertType: "issue",
        acknowledgedById: "u-dana",
        acknowledgedByEmail: "danerez5@gmail.com",
        acknowledgedByDisplayName: "Dana Rez",
        acknowledgedAt: new Date("2026-07-01T10:00:00Z"),
        remindAt: null,
        remindedAt: null,
        ackStatus: "SEEN",
        resolvedAt: null,
        resolvedById: null,
        resolutionNote: null,
      },
    ];

    const { res, captured } = makeRes();
    await dispatch(makeReq({ method: "GET", url: "/" }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as Array<{ acknowledgedByDisplayName: string | null; acknowledgedByEmail: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.acknowledgedByDisplayName).toBe("Dana Rez");
    expect(body[0]?.acknowledgedByEmail).toBe("danerez5@gmail.com");

    // Wiring regression guard: the join to vt_users must be present, and
    // clinic-scoped (never a global users lookup across tenants).
    const joinCall = dbCalls.find((c) => c.method === "leftJoin");
    expect(joinCall).toBeDefined();
    expect(JSON.stringify(joinCall?.args)).toContain("clinic-a");
  });

  it("passes through a null displayName (missing vt_users.name) rather than fabricating one from email", async () => {
    selectRows = [
      {
        id: "ack-2",
        clinicId: "clinic-a",
        equipmentId: "eq-2",
        alertType: "inactive",
        acknowledgedById: "u-ghost",
        acknowledgedByEmail: "ghost@clinic.test",
        acknowledgedByDisplayName: null,
        acknowledgedAt: new Date("2026-07-01T10:00:00Z"),
        remindAt: null,
        remindedAt: null,
        ackStatus: "SEEN",
        resolvedAt: null,
        resolvedById: null,
        resolutionNote: null,
      },
    ];

    const { res, captured } = makeRes();
    await dispatch(makeReq({ method: "GET", url: "/" }), res);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as Array<{ acknowledgedByDisplayName: string | null }>;
    expect(body[0]?.acknowledgedByDisplayName).toBeNull();
  });
});
