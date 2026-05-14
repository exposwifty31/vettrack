/**
 * Unit tests for clinical-check-in.ts route handlers.
 * Drives the Express Router directly (no supertest) with mocked service +
 * auth middleware.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

// ── Service mocks ─────────────────────────────────────────────────────────────

const mockOpenCheckIn = vi.fn();
const mockCloseCheckIn = vi.fn();
const mockGetActiveCheckIn = vi.fn();
const mockGetAllowedOperationalRoles = vi.fn();

vi.mock("../server/services/clinical-check-in.js", async () => {
  class ClinicalCheckInError extends Error {
    status: number;
    code: string;
    reason: string;
    constructor(status: number, code: string, message: string, reason: string = code) {
      super(message);
      this.status = status;
      this.code = code;
      this.reason = reason;
    }
  }
  return {
    openCheckIn: mockOpenCheckIn,
    closeCheckIn: mockCloseCheckIn,
    getActiveCheckIn: mockGetActiveCheckIn,
    getAllowedOperationalRoles: mockGetAllowedOperationalRoles,
    autoCheckOutForSessionEnd: vi.fn(),
    ClinicalCheckInError,
  };
});

// ── Auth middleware mock ──────────────────────────────────────────────────────

let currentAuthUser:
  | {
      id: string;
      email: string;
      clinicId: string;
      role: string;
      clerkId?: string;
      name?: string;
      status?: string;
    }
  | null = {
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
        reason: "MISSING_AUTH_USER",
        message: "Unauthorized",
        requestId: "test-req",
      });
      return;
    }
    (req as Request & { authUser?: unknown }).authUser = currentAuthUser;
    next();
  },
  requireClinicalUser: (req: Request, res: Response, next: NextFunction) => {
    const user = (req as Request & { authUser?: { role?: string } }).authUser;
    const role = user?.role ?? "";
    if (!["admin", "vet", "senior_technician", "technician"].includes(role)) {
      res.status(403).json({
        code: "FORBIDDEN",
        error: "FORBIDDEN",
        reason: "INSUFFICIENT_ROLE",
        message: "Clinical role required",
        requestId: "test-req",
      });
      return;
    }
    next();
  },
}));

// ── Fake req/res helpers ──────────────────────────────────────────────────────

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
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  return {
    method: options.method,
    url: options.url,
    originalUrl: options.url,
    body: options.body ?? {},
    headers: options.headers ?? {},
    params: {},
    query: {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import(
    "../server/routes/clinical-check-in.js"
  );
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
    setTimeout(finish, 200);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  currentAuthUser = {
    id: "user-vet",
    email: "vet@clinic.test",
    clinicId: "clinic-1",
    role: "vet",
  };
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-vet",
    checkedInAt: new Date("2026-05-14T08:00:00Z"),
    checkedOutAt: null,
    operationalRole: "admission",
    clinicalRoleAtCheckIn: "vet",
    activeShiftId: null,
    shiftSessionId: null,
    checkOutReason: null,
    clientId: null,
    createdAt: new Date("2026-05-14T08:00:00Z"),
    ...overrides,
  };
}

describe("POST /check-in — auth gates", () => {
  it("returns 401 when no auth user", async () => {
    currentAuthUser = null;
    const req = makeReq({ method: "POST", url: "/check-in", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(401);
    expect(captured.body).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns 403 when student tries to check in", async () => {
    currentAuthUser = {
      id: "u",
      email: "s@test",
      clinicId: "c",
      role: "student",
    };
    const req = makeReq({ method: "POST", url: "/check-in", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(403);
  });
});

describe("POST /check-in — body validation envelope", () => {
  it("rejects array operationalRole with INVALID_BODY envelope", async () => {
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: ["admission"] },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toMatchObject({
      code: "INVALID_BODY",
      error: "INVALID_BODY",
      reason: "INVALID_BODY",
    });
    expect((captured.body as Record<string, unknown>).requestId).toBeTruthy();
    expect(mockOpenCheckIn).not.toHaveBeenCalled();
  });

  it("rejects unexpected extra keys with INVALID_BODY envelope", async () => {
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission", extra: "nope" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toMatchObject({ code: "INVALID_BODY" });
  });

  it("rejects empty-string operationalRole", async () => {
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toMatchObject({ code: "INVALID_BODY" });
  });
});

describe("POST /check-in — Idempotency-Key handling", () => {
  it("accepts a 64-char key and forwards to service", async () => {
    mockOpenCheckIn.mockResolvedValueOnce({ row: makeRow(), replayed: false });
    const key = "a".repeat(64);
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission" },
      headers: { "idempotency-key": key },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockOpenCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: key }),
    );
  });

  it("rejects 65-char key with IDEMPOTENCY_KEY_TOO_LONG envelope", async () => {
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission" },
      headers: { "idempotency-key": "a".repeat(65) },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toMatchObject({
      code: "IDEMPOTENCY_KEY_TOO_LONG",
      error: "IDEMPOTENCY_KEY_TOO_LONG",
      reason: "IDEMPOTENCY_KEY_TOO_LONG",
    });
    expect(mockOpenCheckIn).not.toHaveBeenCalled();
  });

  it("treats whitespace-only key as absent (service receives null)", async () => {
    mockOpenCheckIn.mockResolvedValueOnce({ row: makeRow(), replayed: false });
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission" },
      headers: { "idempotency-key": "   " },
    });
    const { res } = makeRes();
    await dispatch(req, res);
    expect(mockOpenCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null }),
    );
  });

  it("trims leading/trailing whitespace before forwarding", async () => {
    mockOpenCheckIn.mockResolvedValueOnce({ row: makeRow(), replayed: false });
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission" },
      headers: { "idempotency-key": "  abc-123  " },
    });
    const { res } = makeRes();
    await dispatch(req, res);
    expect(mockOpenCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "abc-123" }),
    );
  });
});

describe("POST /check-in — success + service errors", () => {
  it("returns 200 with ISO-string checkedInAt", async () => {
    mockOpenCheckIn.mockResolvedValueOnce({
      row: makeRow({
        checkedInAt: new Date("2026-05-14T09:30:00Z"),
      }),
      replayed: false,
    });
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as Record<string, unknown>;
    expect(body.id).toBe("ci-1");
    expect(body.clinicId).toBe("clinic-1");
    expect(body.operationalRole).toBe("admission");
    expect(body.checkedInAt).toBe("2026-05-14T09:30:00.000Z");
    expect(typeof body.checkedInAt).toBe("string");
  });

  it("surfaces ClinicalCheckInError as apiError envelope at the right status", async () => {
    const { ClinicalCheckInError } = await import(
      "../server/services/clinical-check-in.js"
    );
    mockOpenCheckIn.mockRejectedValueOnce(
      new ClinicalCheckInError(
        409,
        "ALREADY_CHECKED_IN",
        "User already has an active clinical check-in",
      ),
    );
    const req = makeReq({
      method: "POST",
      url: "/check-in",
      body: { operationalRole: "admission" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      code: "ALREADY_CHECKED_IN",
      error: "ALREADY_CHECKED_IN",
      reason: "ALREADY_CHECKED_IN",
    });
    expect((captured.body as Record<string, unknown>).requestId).toBeTruthy();
  });
});

describe("POST /check-out", () => {
  it("returns ISO-string timestamps on success", async () => {
    mockCloseCheckIn.mockResolvedValueOnce(
      makeRow({
        checkedOutAt: new Date("2026-05-14T16:00:00Z"),
        checkOutReason: "self",
      }),
    );
    const req = makeReq({ method: "POST", url: "/check-out", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as Record<string, unknown>;
    expect(body.checkedInAt).toBe("2026-05-14T08:00:00.000Z");
    expect(body.checkedOutAt).toBe("2026-05-14T16:00:00.000Z");
    expect(body.checkOutReason).toBe("self");
  });

  it("returns 404 NOT_CHECKED_IN when service throws", async () => {
    const { ClinicalCheckInError } = await import(
      "../server/services/clinical-check-in.js"
    );
    mockCloseCheckIn.mockRejectedValueOnce(
      new ClinicalCheckInError(404, "NOT_CHECKED_IN", "no row"),
    );
    const req = makeReq({ method: "POST", url: "/check-out", body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({
      code: "NOT_CHECKED_IN",
      reason: "NOT_CHECKED_IN",
    });
  });
});

describe("GET /me/active", () => {
  it("returns { active: null } when no row", async () => {
    mockGetActiveCheckIn.mockResolvedValueOnce(null);
    const req = makeReq({ method: "GET", url: "/me/active" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({ active: null });
  });

  it("returns active row with ISO-string timestamps", async () => {
    mockGetActiveCheckIn.mockResolvedValueOnce(
      makeRow({ checkedInAt: new Date("2026-05-14T08:00:00Z") }),
    );
    const req = makeReq({ method: "GET", url: "/me/active" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    const body = captured.body as { active: Record<string, unknown> };
    expect(body.active.id).toBe("ci-1");
    expect(body.active.checkedInAt).toBe("2026-05-14T08:00:00.000Z");
    expect(typeof body.active.checkedInAt).toBe("string");
  });
});

describe("GET /me/operational-roles", () => {
  it("returns { allowedOperationalRoles: [...] }", async () => {
    mockGetAllowedOperationalRoles.mockResolvedValueOnce(["admission", "ward"]);
    const req = makeReq({ method: "GET", url: "/me/operational-roles" });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({
      allowedOperationalRoles: ["admission", "ward"],
    });
  });
});
