/**
 * Phase 2.5 PR 4: dispense confirm passes authority observability fields
 * (source / reason / operationalRole) from req.authoritySnapshot into the
 * confirmDispense service, which lands them in the dispense_confirmed audit
 * row's metadata. This is the first explicit route-level consumer of the
 * check-in-derived snapshot fields beyond the existing effectiveClinicalRole
 * read used for actorRole.
 *
 * The route handler is unit-tested in isolation: the dispense service is
 * mocked so we observe the exact arguments the route passes through. No DB,
 * no Express boot, no real middleware.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type { AuthoritySnapshot } from "../shared/authority.js";

const confirmDispenseMock = vi.fn();
const createDraftDispenseMock = vi.fn();
const createEmergencyDispenseMock = vi.fn();

vi.mock("../server/services/dispense.service.js", () => ({
  confirmDispense: (input: unknown) => confirmDispenseMock(input),
  createDraftDispense: (input: unknown) => createDraftDispenseMock(input),
  createEmergencyDispense: (input: unknown) => createEmergencyDispenseMock(input),
  DispenseError: class DispenseError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      message: string,
      public readonly details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = "DispenseError";
    }
  },
}));

vi.mock("../server/middleware/auth.js", () => ({
  requireAuth: (_req: Request, _res: Response, next: () => void) => next(),
  requireClinicalUser: (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../server/middleware/authority.js", () => ({
  requireClinicalAuthority:
    () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: () => void) => next(),
  validateUuid: () => (_req: Request, _res: Response, next: () => void) => next(),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: () => {},
  resolveAuditActorRole: () => "technician",
}));

vi.mock("../server/db.js", () => ({
  db: {},
}));

// ─── Test helpers ───────────────────────────────────────────────────────────
type RecordedRes = { statusCode: number; body: unknown };

function makeRes(): { res: Response; recorded: RecordedRes } {
  const recorded: RecordedRes = { statusCode: 200, body: null };
  const res = {
    status(code: number) {
      recorded.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      recorded.body = payload;
      return this;
    },
    getHeader() {
      return undefined;
    },
    setHeader() {},
  } as unknown as Response;
  return { res, recorded };
}

function makeReq(
  authoritySnapshot: AuthoritySnapshot | undefined,
): Request {
  return {
    headers: {},
    params: { id: "11111111-1111-1111-1111-111111111111" },
    body: {},
    clinicId: "dev-clinic-default",
    authUser: {
      id: "user-1",
      email: "tech@example.com",
      name: "Tech User",
      role: "technician",
    },
    authoritySnapshot,
  } as unknown as Request;
}

async function loadConfirmHandler(): Promise<
  (req: Request, res: Response) => Promise<void> | void
> {
  const dispenseModule = await import("../server/routes/dispense.js");
  const router = dispenseModule.default as unknown as {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: (req: Request, res: Response) => unknown }>;
      };
    }>;
  };
  const layer = router.stack.find(
    (l) => l.route?.path === "/:id/confirm" && l.route?.methods.post,
  );
  if (!layer?.route) throw new Error("POST /:id/confirm handler not found");
  const handler = layer.route.stack[layer.route.stack.length - 1]!.handle as (
    req: Request,
    res: Response,
  ) => Promise<void> | void;
  return handler;
}

const FIXED_RESOLVED_AT = "2026-05-14T12:00:00.000Z";

const checkInSnapshot: AuthoritySnapshot = {
  systemRole: "User",
  clinicalRole: "vet",
  activeShiftRole: "vet",
  operationalRole: "doctor_icu",
  effectiveClinicalRole: "vet",
  source: "check_in",
  reason: "CHECKED_IN",
  resolvedAt: FIXED_RESOLVED_AT,
};

const shiftSnapshot: AuthoritySnapshot = {
  systemRole: "User",
  clinicalRole: "technician",
  activeShiftRole: "technician",
  operationalRole: null,
  effectiveClinicalRole: "technician",
  source: "shift",
  reason: "EZSHIFT_ACTIVE",
  resolvedAt: FIXED_RESOLVED_AT,
};

beforeEach(() => {
  confirmDispenseMock.mockReset();
  // Phase 5 PR 5.7 — `confirmDispense` returns `{ event, copDegraded }`.
  confirmDispenseMock.mockResolvedValue({
    event: {
      id: "11111111-1111-1111-1111-111111111111",
      status: "CONFIRMED",
      inventoryMismatch: false,
    },
    copDegraded: false,
  });
});

describe("POST /api/dispense/:id/confirm — authority observability fields", () => {
  it("passes check-in snapshot source/reason/operationalRole to confirmDispense", async () => {
    const handler = await loadConfirmHandler();
    const { res } = makeRes();
    await handler(makeReq(checkInSnapshot), res);

    expect(confirmDispenseMock).toHaveBeenCalledTimes(1);
    const arg = confirmDispenseMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.authoritySource).toBe("check_in");
    expect(arg.authorityReason).toBe("CHECKED_IN");
    expect(arg.authorityOperationalRole).toBe("doctor_icu");
    expect(arg.actorRole).toBe("vet");
  });

  it("passes legacy shift snapshot source/reason and null operationalRole", async () => {
    const handler = await loadConfirmHandler();
    const { res } = makeRes();
    await handler(makeReq(shiftSnapshot), res);

    expect(confirmDispenseMock).toHaveBeenCalledTimes(1);
    const arg = confirmDispenseMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.authoritySource).toBe("shift");
    expect(arg.authorityReason).toBe("EZSHIFT_ACTIVE");
    expect(arg.authorityOperationalRole).toBeNull();
    expect(arg.actorRole).toBe("technician");
  });

  it("defaults all three authority fields to null when snapshot is missing", async () => {
    const handler = await loadConfirmHandler();
    const { res } = makeRes();
    await handler(makeReq(undefined), res);

    expect(confirmDispenseMock).toHaveBeenCalledTimes(1);
    const arg = confirmDispenseMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.authoritySource).toBeNull();
    expect(arg.authorityReason).toBeNull();
    expect(arg.authorityOperationalRole).toBeNull();
  });
});
