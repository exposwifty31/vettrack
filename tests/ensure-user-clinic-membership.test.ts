/**
 * Defense-in-depth clinic membership guard (ensure-user-clinic-membership.ts).
 * Blocks authenticated users whose vt_users row is not in req.clinicId.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock("../server/db.js", () => ({
  db: { select: (...args: unknown[]) => mockSelect(...args) },
  users: { id: "id", clinicId: "clinicId", deletedAt: "deletedAt" },
}));

import { ensureUserClinicMembership } from "../server/middleware/ensure-user-clinic-membership.js";

type Captured = { statusCode: number; body: unknown };

function makeRes(): { res: Response; captured: Captured; next: ReturnType<typeof vi.fn> } {
  const captured: Captured = { statusCode: 200, body: null };
  const next = vi.fn();
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, captured, next };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    authUser: { id: "user-1" },
    clinicId: "clinic-1",
    ...overrides,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockResolvedValue([{ id: "user-1" }]);
});

describe("ensureUserClinicMembership", () => {
  it("returns 400 MISSING_CONTEXT when authUser is absent", async () => {
    const { res, captured, next } = makeRes();
    await ensureUserClinicMembership(makeReq({ authUser: undefined }), res, next as NextFunction);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { reason?: string }).reason).toBe("MISSING_CONTEXT");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 MISSING_CONTEXT when clinicId is blank", async () => {
    const { res, captured, next } = makeRes();
    await ensureUserClinicMembership(makeReq({ clinicId: "   " }), res, next as NextFunction);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { reason?: string }).reason).toBe("MISSING_CONTEXT");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 CLINIC_MEMBERSHIP_DENIED when user row is not in clinic", async () => {
    mockLimit.mockResolvedValue([]);
    const { res, captured, next } = makeRes();
    await ensureUserClinicMembership(makeReq(), res, next as NextFunction);
    expect(captured.statusCode).toBe(403);
    expect((captured.body as { reason?: string }).reason).toBe("CLINIC_MEMBERSHIP_DENIED");
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when user belongs to the clinic", async () => {
    const { res, captured, next } = makeRes();
    await ensureUserClinicMembership(makeReq(), res, next as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(captured.body).toBeNull();
  });

  it("returns 500 when the membership lookup throws", async () => {
    mockLimit.mockRejectedValue(new Error("db down"));
    const { res, captured, next } = makeRes();
    await ensureUserClinicMembership(makeReq(), res, next as NextFunction);
    expect(captured.statusCode).toBe(500);
    expect((captured.body as { reason?: string }).reason).toBe("CLINIC_CHECK_FAILED");
    expect(next).not.toHaveBeenCalled();
  });
});
