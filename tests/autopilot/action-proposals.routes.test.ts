/**
 * Unit tests for action-proposals.ts route handlers.
 * Drives the Express Router directly (no supertest) with mocked service +
 * writer + auth middleware, mirroring tests/clinical-check-in.routes.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mockFindStaged = vi.fn();
const mockApproveProposal = vi.fn();
const mockEditProposal = vi.fn();
const mockRejectProposal = vi.fn();

vi.mock("../../server/lib/autopilot/action-proposal-writer.port.js", async () => {
  class ActionProposalAlreadyDecidedError extends Error {}
  return {
    DrizzleActionProposalWriter: class {
      findStaged = mockFindStaged;
    },
    ActionProposalAlreadyDecidedError,
  };
});

vi.mock("../../server/lib/autopilot/action-proposal-service.js", async () => {
  class ActionProposalNotFoundError extends Error {}
  return {
    approveProposal: mockApproveProposal,
    editProposal: mockEditProposal,
    rejectProposal: mockRejectProposal,
    ActionProposalNotFoundError,
  };
});

let currentAuthUser:
  | { id: string; email: string; clinicId: string; role: string }
  | null = {
  id: "user-vet",
  email: "vet@clinic.test",
  clinicId: "clinic-1",
  role: "vet",
};

vi.mock("../../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    (req as Request & { authUser?: unknown }).authUser = currentAuthUser;
    next();
  },
}));

vi.mock("../../server/middleware/rate-limiters.js", () => ({
  actionProposalDecisionLimiter: (req: Request, res: Response, next: NextFunction) => next(),
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
  } as unknown as Response;
  return { res, captured };
}

function makeReq(options: {
  method: string;
  url: string;
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
}): Request {
  return {
    method: options.method,
    url: options.url,
    originalUrl: options.url,
    body: options.body ?? {},
    headers: {},
    params: options.params ?? {},
    query: options.query ?? {},
    locale: "en",
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../../server/routes/action-proposals.js");
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
  vi.clearAllMocks();
  currentAuthUser = { id: "user-vet", email: "vet@clinic.test", clinicId: "clinic-1", role: "vet" };
});

describe("GET /api/action-proposals", () => {
  it("scopes the list by the authenticated clinicId, never from query/body", async () => {
    mockFindStaged.mockResolvedValueOnce([]);
    const req = makeReq({ method: "GET", url: "/", query: { status: "staged", clinicId: "attacker-clinic" } });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockFindStaged).toHaveBeenCalledWith(
      "clinic-1",
      expect.objectContaining({ status: "staged" }),
    );
  });

  it("ignores an out-of-enum status filter rather than passing it through", async () => {
    mockFindStaged.mockResolvedValueOnce([]);
    const req = makeReq({ method: "GET", url: "/", query: { status: "not-a-real-status" } });
    const { res } = makeRes();
    await dispatch(req, res);
    expect(mockFindStaged).toHaveBeenCalledWith("clinic-1", expect.objectContaining({ status: undefined }));
  });
});

describe("POST /api/action-proposals/:id/approve", () => {
  it("rejects a body with extra keys (strict schema)", async () => {
    const req = makeReq({ method: "POST", url: "/p1/approve", params: { id: "p1" }, body: { hack: true } });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(mockApproveProposal).not.toHaveBeenCalled();
  });

  it("approves using clinicId from req.authUser", async () => {
    mockApproveProposal.mockResolvedValueOnce({ id: "p1", status: "approved" });
    const req = makeReq({ method: "POST", url: "/p1/approve", params: { id: "p1" }, body: {} });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockApproveProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clinicId: "clinic-1", proposalId: "p1", actorUserId: "user-vet" }),
    );
  });
});

describe("POST /api/action-proposals/:id/reject", () => {
  it("rejects an empty rejectionReason with 400", async () => {
    const req = makeReq({
      method: "POST",
      url: "/p1/reject",
      params: { id: "p1" },
      body: { rejectionReason: "" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(mockRejectProposal).not.toHaveBeenCalled();
  });

  it("maps ActionProposalNotFoundError to 404", async () => {
    const { ActionProposalNotFoundError } = await import("../../server/lib/autopilot/action-proposal-service.js");
    mockRejectProposal.mockRejectedValueOnce(new ActionProposalNotFoundError("p1"));
    const req = makeReq({
      method: "POST",
      url: "/p1/reject",
      params: { id: "p1" },
      body: { rejectionReason: "not applicable" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(404);
  });
});

describe("POST /api/action-proposals/:id/edit", () => {
  it("rejects a non-object editedContent with 400", async () => {
    const req = makeReq({
      method: "POST",
      url: "/p1/edit",
      params: { id: "p1" },
      body: { editedContent: "nope" },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(400);
    expect(mockEditProposal).not.toHaveBeenCalled();
  });

  it("passes editedContent through on a valid object body", async () => {
    mockEditProposal.mockResolvedValueOnce({ id: "p1", status: "edited" });
    const req = makeReq({
      method: "POST",
      url: "/p1/edit",
      params: { id: "p1" },
      body: { editedContent: { note: "changed" } },
    });
    const { res, captured } = makeRes();
    await dispatch(req, res);
    expect(captured.statusCode).toBe(200);
    expect(mockEditProposal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ editedContent: { note: "changed" } }),
    );
  });
});
