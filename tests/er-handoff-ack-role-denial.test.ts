/**
 * Regression test for the ER handoff ack-route role guard (PR-39).
 *
 * PR-10 added `requireAssignableRole` to POST /api/er/handoffs/:id/ack so
 * that `student` (and any non-clinical-floor role) is denied at the route
 * boundary, matching the create/assign routes. This locks that 403.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mockAckErHandoffItem = vi.fn();

vi.mock("../server/services/er-handoff.service.js", () => ({
  ackErHandoffItem: mockAckErHandoffItem,
  createErHandoff: vi.fn(),
  listErHandoffEligibleHospitalizations: vi.fn(),
}));

let currentAuthUser:
  | { id: string; email: string; clinicId: string; role: string }
  | null = null;

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuthUser) {
      res.status(401).json({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER" });
      return;
    }
    (req as Request & { authUser?: unknown; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  },
  requireEffectiveRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

type Captured = { statusCode: number; body: unknown };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null };
  const headers = new Map<string, string>();
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
  } as unknown as Response;
  return { res, captured };
}

function makeReq(): Request {
  return {
    method: "POST",
    url: "/handoffs/item-1/ack",
    originalUrl: "/api/er/handoffs/item-1/ack",
    body: {},
    headers: {},
    params: { id: "item-1" },
    query: {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/er.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      const ret = origJson(payload);
      setImmediate(finish);
      return ret;
    };
    router(req, res, () => finish());
    setTimeout(finish, 300);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAckErHandoffItem.mockResolvedValue({ id: "item-1", acknowledgedAt: new Date().toISOString() });
});

describe("POST /api/er/handoffs/:id/ack — role guard", () => {
  it("denies a student with 403 INSUFFICIENT_ROLE", async () => {
    currentAuthUser = { id: "u-student", email: "s@clinic.test", clinicId: "c1", role: "student" };
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);
    expect(captured.statusCode).toBe(403);
    expect((captured.body as { reason?: string }).reason).toBe("INSUFFICIENT_ROLE");
    expect(mockAckErHandoffItem).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no authenticated user", async () => {
    currentAuthUser = null;
    const { res, captured } = makeRes();
    await dispatch(makeReq(), res);
    expect(captured.statusCode).toBe(401);
    expect(mockAckErHandoffItem).not.toHaveBeenCalled();
  });

  for (const role of ["technician", "senior_technician", "vet", "admin"]) {
    it(`admits an assignable role (${role}) past the route guard`, async () => {
      currentAuthUser = { id: `u-${role}`, email: `${role}@clinic.test`, clinicId: "c1", role };
      const { res, captured } = makeRes();
      await dispatch(makeReq(), res);
      expect(captured.statusCode).not.toBe(403);
      expect(mockAckErHandoffItem).toHaveBeenCalledTimes(1);
    });
  }
});
