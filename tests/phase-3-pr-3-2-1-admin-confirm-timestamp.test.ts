/**
 * Phase 3 PR 3.2.1 — Admin-confirm `acknowledgedAt` regression test.
 *
 * Cursor Bugbot Medium finding on PR 3.2: the admin confirm path was
 * setting `acknowledgedAt: now` (the admin's confirmation time) while
 * the worker auto-resolve path correctly hydrated from
 * `metadata.acknowledged_at`. This created an inconsistent typed
 * column — auto-resolved rows got the historical timestamp, manually
 * confirmed rows got the (potentially much later) admin action time.
 *
 * Fix: the confirm path now reads `metadata.acknowledged_at` from the
 * appointment row inside the transaction and uses that for the typed
 * `acknowledgedAt` column. Falls back to `now` when missing —
 * matching the worker's `input.acknowledgedAtFromMetadata ?? new
 * Date()` pattern so both paths produce consistent column values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

// Auth mock
let currentAuthUser: { id: string; email: string; clinicId: string; role: string } | null = {
  id: "admin-1",
  email: "admin@clinic.test",
  clinicId: "clinic-1",
  role: "admin",
};
vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { authUser?: unknown; clinicId?: string }).clinicId = currentAuthUser?.clinicId;
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Queue + resolver + audit mocks
const mockEnqueue = vi.fn();
const mockGetJob = vi.fn();
vi.mock("../server/queues/taskOwnershipBackfill.queue.js", () => ({
  taskOwnershipBackfillQueue: {
    enqueue: (...a: unknown[]) => mockEnqueue(...a),
    getJob: (...a: unknown[]) => mockGetJob(...a),
  },
}));
const mockValidateCandidate = vi.fn();
vi.mock("../server/lib/task-ownership-resolver.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../server/lib/task-ownership-resolver.js")>();
  return {
    ...original,
    validateConfirmationCandidate: (...a: unknown[]) => mockValidateCandidate(...a),
  };
});
const mockLogAudit = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...a: unknown[]) => mockLogAudit(...a),
  resolveAuditActorRole: () => "admin",
}));

// DB mock: stateful — `metadataValue` controls what tx.select returns
// for the appointment lookup. `appointmentUpdates` captures the
// arguments to the `set()` call on the appointment update so the test
// can assert what `acknowledgedAt` was actually written.
const dbState: {
  pendingRow: unknown;
  metadataValue: Record<string, unknown> | null;
  appointmentSetArgs: unknown[];
} = {
  pendingRow: null,
  metadataValue: null,
  appointmentSetArgs: [],
};

vi.mock("../server/db.js", () => {
  // Outer (non-tx) select / update / insert resolve to the existing
  // pendingRow / no-op behavior.
  const outerSelect = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (dbState.pendingRow ? [dbState.pendingRow] : []),
      }),
    }),
  });

  return {
    db: {
      select: outerSelect,
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        let lastSelectTable: "queue" | "appointment" = "queue";
        let lastUpdateTable: "queue" | "appointment" = "queue";
        const tx = {
          // tx.update().set().where().returning(): used for both the
          // queue row update (returning the row) and the appointment
          // update (which does not call .returning()).
          update: (table: unknown) => {
            lastUpdateTable =
              (table as { id?: string })?.id === "appointments.id" ? "appointment" : "queue";
            return {
              set: (args: unknown) => {
                if (lastUpdateTable === "appointment") {
                  dbState.appointmentSetArgs.push(args);
                }
                return {
                  where: () => ({
                    returning: async () =>
                      lastUpdateTable === "queue" && dbState.pendingRow
                        ? [dbState.pendingRow]
                        : [],
                  }),
                };
              },
            };
          },
          // tx.select().from().where().limit(): returns the appointment
          // row whose metadata field is dbState.metadataValue.
          select: () => ({
            from: (table: unknown) => {
              lastSelectTable =
                (table as { id?: string })?.id === "appointments.id" ? "appointment" : "queue";
              return {
                where: () => ({
                  limit: async () => {
                    if (lastSelectTable === "appointment") {
                      return [{ metadata: dbState.metadataValue }];
                    }
                    return [];
                  },
                }),
              };
            },
          }),
        };
        return fn(tx);
      },
    },
    appointments: { id: "appointments.id", clinicId: "appointments.clinicId", acknowledgedUserId: "appointments.acknowledgedUserId", metadata: "appointments.metadata" },
    taskOwnershipConfirmQueue: {
      id: "queue.id",
      clinicId: "queue.clinicId",
      appointmentId: "queue.appointmentId",
      resolvedSource: "queue.resolvedSource",
      createdAt: "queue.createdAt",
    },
    users: {},
  };
});

// Test harness
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
function makeReq(opts: { method: string; url: string; body?: unknown; params?: Record<string, string> }): Request {
  return {
    method: opts.method,
    url: opts.url,
    originalUrl: opts.url,
    body: opts.body ?? {},
    headers: {},
    params: opts.params ?? {},
    query: {},
  } as unknown as Request;
}
async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/admin-task-ownership.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => { const r = origJson(payload); setImmediate(finish); return r; };
    router(req, res, () => finish());
    setTimeout(finish, 300);
  });
}

const PENDING_ROW = {
  id: "q-1",
  clinicId: "clinic-1",
  appointmentId: "appt-1",
  rawAcknowledgedBy: "user-a-id",
  candidateUserIds: ["user-a-id"],
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

beforeEach(() => {
  dbState.pendingRow = PENDING_ROW;
  dbState.metadataValue = null;
  dbState.appointmentSetArgs = [];
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

describe("PR 3.2.1 — admin confirm hydrates acknowledgedAt from metadata", () => {
  it("metadata.acknowledged_at present → acknowledgedAt = parsed historical timestamp", async () => {
    const historical = "2026-05-10T08:30:00.000Z";
    dbState.metadataValue = { acknowledgedBy: "user-a-id", acknowledged_at: historical };
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
    expect(dbState.appointmentSetArgs.length).toBe(1);
    const setArgs = dbState.appointmentSetArgs[0] as { acknowledgedAt: Date | null; acknowledgedUserId: string };
    expect(setArgs.acknowledgedUserId).toBe("user-a-id");
    // Crucial: the typed FK timestamp is the HISTORICAL ack time, not
    // the admin's confirmation `now`.
    expect(setArgs.acknowledgedAt).toBeInstanceOf(Date);
    expect((setArgs.acknowledgedAt as Date).toISOString()).toBe(historical);
  });

  it("metadata.acknowledged_at MISSING → acknowledgedAt = now (matches worker `?? new Date()` fallback)", async () => {
    dbState.metadataValue = { acknowledgedBy: "user-a-id" }; // no acknowledged_at
    mockValidateCandidate.mockResolvedValueOnce(null);
    const beforeRequest = Date.now();
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    const afterRequest = Date.now();
    expect(captured.statusCode).toBe(200);
    const setArgs = dbState.appointmentSetArgs[0] as { acknowledgedAt: Date };
    // Fallback to `now` — the value should be a Date within the request
    // window (matches the worker's input.acknowledgedAtFromMetadata ?? new Date()).
    expect(setArgs.acknowledgedAt).toBeInstanceOf(Date);
    const ackMs = setArgs.acknowledgedAt.getTime();
    expect(ackMs).toBeGreaterThanOrEqual(beforeRequest);
    expect(ackMs).toBeLessThanOrEqual(afterRequest);
  });

  it("metadata.acknowledged_at UNPARSEABLE → acknowledgedAt = now (defensive, worker-consistent)", async () => {
    dbState.metadataValue = { acknowledged_at: "not-a-date" };
    mockValidateCandidate.mockResolvedValueOnce(null);
    const beforeRequest = Date.now();
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    const afterRequest = Date.now();
    expect(captured.statusCode).toBe(200);
    const setArgs = dbState.appointmentSetArgs[0] as { acknowledgedAt: Date };
    expect(setArgs.acknowledgedAt).toBeInstanceOf(Date);
    const ackMs = setArgs.acknowledgedAt.getTime();
    expect(ackMs).toBeGreaterThanOrEqual(beforeRequest);
    expect(ackMs).toBeLessThanOrEqual(afterRequest);
  });

  it("metadata = null (no metadata at all) → acknowledgedAt = now", async () => {
    dbState.metadataValue = null;
    mockValidateCandidate.mockResolvedValueOnce(null);
    const beforeRequest = Date.now();
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/confirm",
      params: { id: "q-1" },
      body: { confirmedUserId: "user-a-id" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    const afterRequest = Date.now();
    expect(captured.statusCode).toBe(200);
    const setArgs = dbState.appointmentSetArgs[0] as { acknowledgedAt: Date };
    expect(setArgs.acknowledgedAt).toBeInstanceOf(Date);
    const ackMs = setArgs.acknowledgedAt.getTime();
    expect(ackMs).toBeGreaterThanOrEqual(beforeRequest);
    expect(ackMs).toBeLessThanOrEqual(afterRequest);
  });

  it("reject path does NOT update the appointment (no acknowledgedAt write)", async () => {
    dbState.metadataValue = { acknowledged_at: "2026-05-10T08:30:00.000Z" };
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/reject",
      params: { id: "q-1" },
      body: {},
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(dbState.appointmentSetArgs.length).toBe(0);
  });

  it("skip path does NOT update the appointment (no acknowledgedAt write)", async () => {
    dbState.metadataValue = { acknowledged_at: "2026-05-10T08:30:00.000Z" };
    const req = makeReq({
      method: "POST",
      url: "/task-ownership/queue/q-1/skip",
      params: { id: "q-1" },
      body: {},
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(dbState.appointmentSetArgs.length).toBe(0);
  });
});
