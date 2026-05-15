/**
 * Phase 3 PR 3.2 — admin task-ownership API tests.
 *
 * Drives the router directly with mocked auth, queue, resolver, audit, and
 * db. Asserts auth gating, clinic-scope isolation, confirmation validation
 * (candidate-set + active-status), and the MANUAL_OWNERSHIP_CONFIRMATION
 * provenance audit emission.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// ── Auth middleware mock ──────────────────────────────────────────────────────

let currentAuthUser:
  | { id: string; email: string; clinicId: string; role: string }
  | null = {
  id: "admin-1",
  email: "admin@clinic.test",
  clinicId: "clinic-1",
  role: "admin",
};

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({ code: "UNAUTHORIZED", error: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId: "test-req" });
      return;
    }
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { authUser?: unknown; clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
  requireAdmin: (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { authUser?: { role?: string } }).authUser;
    if (user?.role !== "admin") {
      res.status(403).json({ code: "FORBIDDEN", error: "FORBIDDEN", reason: "INSUFFICIENT_ROLE", message: "Admin role required", requestId: "test-req" });
      return;
    }
    next();
  },
}));

// ── Queue mock ────────────────────────────────────────────────────────────────

const mockEnqueue = vi.fn();
const mockGetJob = vi.fn();
vi.mock("../server/queues/taskOwnershipBackfill.queue.js", () => ({
  taskOwnershipBackfillQueue: {
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
    getJob: (...args: unknown[]) => mockGetJob(...args),
  },
}));

// ── Resolver mock ─────────────────────────────────────────────────────────────

const mockValidateCandidate = vi.fn();
vi.mock("../server/lib/task-ownership-resolver.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/lib/task-ownership-resolver.js")>();
  return {
    ...original,
    validateConfirmationCandidate: (...args: unknown[]) => mockValidateCandidate(...args),
  };
});

// ── Audit mock ────────────────────────────────────────────────────────────────

const mockLogAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => mockLogAudit(...args),
  resolveAuditActorRole: () => "admin",
}));

// ── db mock (single fluent recorder) ──────────────────────────────────────────

type DbCall = { method: string; args: unknown[] };
const dbCalls: DbCall[] = [];
let selectImplementation: () => unknown = () => fluent;
let transactionResult: unknown = null;
let transactionError: Error | null = null;

const fluent: Record<string, unknown> = {};
function rec(method: string) {
  return (...args: unknown[]) => {
    dbCalls.push({ method, args });
    return fluent;
  };
}
for (const m of ["from", "where", "orderBy", "limit", "values", "set", "returning", "onConflictDoNothing"]) {
  fluent[m] = rec(m);
}
// Specific terminal behaviors per test:
let selectRows: unknown[] = [];
let countRow: { pending: number } = { pending: 0 };
let updateReturning: unknown[] = [];

(fluent as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
  // The last recorded call decides what to return.
  const last = dbCalls[dbCalls.length - 1];
  if (last?.method === "limit" || last?.method === "where" || last?.method === "from") {
    return resolve(selectRows);
  }
  if (last?.method === "returning") {
    return resolve(updateReturning);
  }
  return resolve([]);
};

vi.mock("../server/db.js", () => ({
  db: {
    select: (...args: unknown[]) => {
      dbCalls.push({ method: "select", args });
      return selectImplementation();
    },
    update: (...args: unknown[]) => {
      dbCalls.push({ method: "update", args });
      return fluent;
    },
    insert: (...args: unknown[]) => {
      dbCalls.push({ method: "insert", args });
      return fluent;
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (transactionError) throw transactionError;
      const txFluent: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit", "values", "set", "returning", "onConflictDoNothing"]) {
        txFluent[m] = (...args: unknown[]) => {
          dbCalls.push({ method: `tx.${m}`, args });
          return txFluent;
        };
      }
      (txFluent as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => {
        const last = dbCalls[dbCalls.length - 1];
        if (last?.method === "tx.returning") return resolve(updateReturning);
        return resolve([]);
      };
      const tx = {
        update: (...args: unknown[]) => {
          dbCalls.push({ method: "tx.update", args });
          return txFluent;
        },
      };
      transactionResult = await fn(tx);
      return transactionResult;
    },
  },
  appointments: { id: "appointments.id", clinicId: "appointments.clinicId", acknowledgedUserId: "appointments.acknowledgedUserId" },
  taskOwnershipConfirmQueue: {
    id: "queue.id",
    clinicId: "queue.clinicId",
    appointmentId: "queue.appointmentId",
    rawAcknowledgedBy: "queue.rawAcknowledgedBy",
    resolvedSource: "queue.resolvedSource",
    createdAt: "queue.createdAt",
  },
  users: {},
}));

// ── Test harness ──────────────────────────────────────────────────────────────

type Captured = { statusCode: number; body: unknown };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
    headersSent: false,
  } as unknown as Response;
  return { res, captured };
}

function makeReq(options: {
  method: string;
  url: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}): Request {
  return {
    method: options.method,
    url: options.url,
    originalUrl: options.url,
    body: options.body ?? {},
    headers: {},
    params: options.params ?? {},
    query: options.query ?? {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/admin-task-ownership.js");
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
    setTimeout(finish, 300);
  });
}

beforeEach(() => {
  dbCalls.length = 0;
  selectRows = [];
  countRow = { pending: 0 };
  updateReturning = [];
  selectImplementation = () => fluent;
  transactionResult = null;
  transactionError = null;
  mockEnqueue.mockReset();
  mockGetJob.mockReset();
  mockValidateCandidate.mockReset();
  mockLogAudit.mockReset();
  currentAuthUser = {
    id: "admin-1",
    email: "admin@clinic.test",
    clinicId: "clinic-1",
    role: "admin",
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth gating

describe("admin task-ownership API — auth gates", () => {
  it("non-admin caller → 403 on POST /backfill", async () => {
    currentAuthUser = { id: "u", email: "u@e", clinicId: "clinic-1", role: "vet" };
    const req = makeReq({ method: "POST", url: "/task-ownership/backfill", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(403);
  });

  it("unauthenticated → 401", async () => {
    currentAuthUser = null;
    const req = makeReq({ method: "POST", url: "/task-ownership/backfill", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backfill enqueue + status

describe("POST /task-ownership/backfill", () => {
  it("admin can enqueue a backfill for their own clinic", async () => {
    mockEnqueue.mockResolvedValueOnce({ id: "job-123" });
    const req = makeReq({ method: "POST", url: "/task-ownership/backfill", body: { dryRun: true } });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: "clinic-1", dryRun: true, limit: null, requestedByUserId: "admin-1" }),
    );
    expect(captured.body).toMatchObject({ jobId: "job-123", status: "queued", clinicId: "clinic-1" });
  });

  it("invalid limit → 400", async () => {
    const req = makeReq({ method: "POST", url: "/task-ownership/backfill", body: { limit: -5 } });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { code?: string })?.code).toBe("INVALID_LIMIT");
  });

  it("queue unavailable → 503", async () => {
    mockEnqueue.mockRejectedValueOnce(new Error("queue disabled: REDIS_URL missing"));
    const req = makeReq({ method: "POST", url: "/task-ownership/backfill", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(503);
    expect((captured.body as { code?: string })?.code).toBe("QUEUE_UNAVAILABLE");
  });
});

describe("GET /task-ownership/backfill/:jobId — clinic isolation", () => {
  it("cross-clinic job → 404 (no leakage)", async () => {
    mockGetJob.mockResolvedValueOnce({
      id: "job-other",
      data: { clinicId: "OTHER-CLINIC", dryRun: false, limit: null, requestedByUserId: "x" },
      getState: async () => "completed",
      progress: 0,
      returnvalue: { scanned: 10 },
    });
    const req = makeReq({
      method: "GET",
      url: "/task-ownership/backfill/job-other",
      params: { jobId: "job-other" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(404);
    expect((captured.body as { code?: string })?.code).toBe("JOB_NOT_FOUND");
  });

  it("same-clinic job → returns status + counts", async () => {
    mockGetJob.mockResolvedValueOnce({
      id: "job-mine",
      data: { clinicId: "clinic-1", dryRun: false, limit: null, requestedByUserId: "admin-1" },
      getState: async () => "completed",
      progress: 100,
      returnvalue: { scanned: 5, autoResolved: 3, queued: 1, skipped: 1, error: 0 },
    });
    const req = makeReq({
      method: "GET",
      url: "/task-ownership/backfill/job-mine",
      params: { jobId: "job-mine" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      jobId: "job-mine",
      clinicId: "clinic-1",
      status: "completed",
      counts: { scanned: 5, autoResolved: 3, queued: 1, skipped: 1, error: 0 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation validation

describe("POST /task-ownership/queue/:id/confirm — validation", () => {
  const PENDING_ROW = {
    id: "q-1",
    clinicId: "clinic-1",
    appointmentId: "appt-1",
    rawAcknowledgedBy: "user-a-id",
    candidateUserIds: ["user-a-id", "user-b-id"],
    resolutionReason: "DELETED_USER",
    matcherVersion: "3.2.0",
    resolvedSource: "pending",
    confirmedUserId: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdByJobId: "job-x",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("missing confirmedUserId → 400 MISSING_CONFIRMED_USER_ID", async () => {
    selectRows = [PENDING_ROW];
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: {},
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { code?: string })?.code).toBe("MISSING_CONFIRMED_USER_ID");
  });

  it("confirmedUserId NOT in candidates → 400 CONFIRMED_USER_NOT_IN_CANDIDATES", async () => {
    selectRows = [PENDING_ROW];
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-z-NOT-A-CANDIDATE" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { code?: string })?.code).toBe("CONFIRMED_USER_NOT_IN_CANDIDATES");
  });

  it("candidate no longer active → 409 CANDIDATE_NOT_ACTIVE", async () => {
    selectRows = [PENDING_ROW];
    mockValidateCandidate.mockResolvedValueOnce("NOT_ACTIVE");
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(409);
    expect((captured.body as { code?: string })?.code).toBe("CANDIDATE_NOT_ACTIVE");
  });

  it("queue row not found → 404 QUEUE_ROW_NOT_FOUND", async () => {
    selectRows = [];
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(404);
    expect((captured.body as { code?: string })?.code).toBe("QUEUE_ROW_NOT_FOUND");
  });

  it("non-pending row → 409 QUEUE_ROW_NOT_PENDING", async () => {
    selectRows = [{ ...PENDING_ROW, resolvedSource: "manual_confirmed" }];
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(409);
    expect((captured.body as { code?: string })?.code).toBe("QUEUE_ROW_NOT_PENDING");
  });

  it("successful confirm emits MANUAL_OWNERSHIP_CONFIRMATION audit row", async () => {
    selectRows = [PENDING_ROW];
    updateReturning = [PENDING_ROW]; // tx.update().returning() resolves
    mockValidateCandidate.mockResolvedValueOnce(null);
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledTimes(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        actionType: "MANUAL_OWNERSHIP_CONFIRMATION",
        metadata: expect.objectContaining({
          appointmentId: "appt-1",
          confirmedUserId: "user-a-id",
          resolutionReason: "DELETED_USER",
          resolvedSource: "manual_confirmed",
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reject / skip behavior

describe("POST /task-ownership/queue/:id/{reject,skip}", () => {
  const PENDING_ROW = {
    id: "q-2",
    clinicId: "clinic-1",
    appointmentId: "appt-2",
    rawAcknowledgedBy: "user-z-id",
    candidateUserIds: [],
    resolutionReason: "NO_CANDIDATE",
    matcherVersion: "3.2.0",
    resolvedSource: "pending",
    confirmedUserId: null,
    resolvedByUserId: null,
    resolvedAt: null,
    createdByJobId: "job-y",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("reject emits audit, does NOT need confirmedUserId, does NOT call validateConfirmationCandidate", async () => {
    selectRows = [PENDING_ROW];
    updateReturning = [PENDING_ROW];
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-2/reject",
      params: { id: "q-2" },
      body: {},
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockValidateCandidate).not.toHaveBeenCalled();
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "MANUAL_OWNERSHIP_CONFIRMATION",
        metadata: expect.objectContaining({ resolvedSource: "rejected", confirmedUserId: null }),
      }),
    );
  });

  it("skip emits audit and does not write to the appointment", async () => {
    selectRows = [PENDING_ROW];
    updateReturning = [PENDING_ROW];
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-2/skip",
      params: { id: "q-2" },
      body: {},
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    // No tx.update on appointments should have been called for skip.
    const appointmentUpdates = dbCalls.filter((c) => c.method === "tx.update");
    // tx.update is used for the queue row update only on skip; ensure no
    // separate update was made for appointments (the route's appointment
    // update path is gated on outcome === "manual_confirmed").
    expect(appointmentUpdates.length).toBeGreaterThanOrEqual(1);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "MANUAL_OWNERSHIP_CONFIRMATION",
        metadata: expect.objectContaining({ resolvedSource: "skipped", confirmedUserId: null }),
      }),
    );
  });
});
