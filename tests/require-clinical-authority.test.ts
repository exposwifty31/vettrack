/**
 * Phase 2B.1: Unit tests for requireClinicalAuthority middleware.
 *
 * Pure unit tests with resolveAuthority mocked. No DB, no Express boot,
 * no network.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
  ActiveShiftRole,
  AuthorityReason,
  AuthoritySnapshot,
  ClinicalRole,
} from "../shared/authority.js";

const resolveAuthorityMock = vi.fn<
  (input: unknown) => Promise<AuthoritySnapshot>
>();

vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));

// Prevent server/db.ts from being touched by the import chain via access-denied.
vi.mock("../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
}));

import { requireClinicalAuthority } from "../server/middleware/authority.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type FakeRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  getHeader: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  statusCode?: number;
  body?: unknown;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    status: vi.fn(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue(undefined),
    setHeader: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function makeReq(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    headers: { "x-request-id": "req-test-1" },
    clinicId: "clinic-1",
    authUser: {
      id: "user-1",
      name: "Test User",
      role: "technician",
      clerkId: "clerk-1",
      email: "u@example.com",
      status: "active",
      clinicId: "clinic-1",
    },
    ...overrides,
  };
}

function makeSnapshot(
  args: Partial<AuthoritySnapshot> & {
    effectiveClinicalRole: ActiveShiftRole | null;
    reason: AuthorityReason;
  },
): AuthoritySnapshot {
  return {
    systemRole: args.systemRole ?? "User",
    clinicalRole: (args.clinicalRole ?? null) as ClinicalRole | null,
    activeShiftRole: args.activeShiftRole ?? null,
    operationalRole: null,
    effectiveClinicalRole: args.effectiveClinicalRole,
    source: args.source ?? "no_active_shift",
    reason: args.reason,
    resolvedAt: args.resolvedAt ?? "2026-05-14T12:00:00.000Z",
  };
}

beforeEach(() => {
  resolveAuthorityMock.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("requireClinicalAuthority — factory validation", () => {
  it("throws synchronously when allow is empty", () => {
    expect(() => requireClinicalAuthority({ allow: [] })).toThrow();
  });

  it("throws synchronously when allow contains invalid role (student)", () => {
    expect(() =>
      requireClinicalAuthority({
        allow: ["student" as unknown as ActiveShiftRole],
      }),
    ).toThrow();
  });

  it("throws synchronously when allow contains invalid role (admin)", () => {
    expect(() =>
      requireClinicalAuthority({
        allow: ["admin" as unknown as ActiveShiftRole],
      }),
    ).toThrow();
  });

  it("throws synchronously when BOTH permanent-role fallbacks are enabled (mutually exclusive)", () => {
    expect(() =>
      requireClinicalAuthority({
        allow: ["vet"],
        allowPermanentClinicalRoleFallbackForLegacyDispense: true,
        allowPermanentClinicalRoleForEmergency: true,
      }),
    ).toThrow(/mutually exclusive/);
  });

  it("does NOT throw when only the emergency break-glass flag is enabled", () => {
    expect(() =>
      requireClinicalAuthority({
        allow: ["vet"],
        allowPermanentClinicalRoleForEmergency: true,
      }),
    ).not.toThrow();
  });

  it("does NOT throw when only the legacy-dispense fallback flag is enabled", () => {
    expect(() =>
      requireClinicalAuthority({
        allow: ["vet"],
        allowPermanentClinicalRoleFallbackForLegacyDispense: true,
      }),
    ).not.toThrow();
  });
});

describe("requireClinicalAuthority — authentication", () => {
  it("returns 401 when req.authUser absent", async () => {
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq({ authUser: undefined });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      code: "UNAUTHORIZED",
      error: "UNAUTHORIZED",
      reason: "MISSING_AUTH_USER",
    });
  });
});

describe("requireClinicalAuthority — primary authority check", () => {
  it("allows vet when allow=[vet]", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "vet",
        activeShiftRole: "vet",
        clinicalRole: "vet",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("allows senior_technician when allow=[vet, senior_technician, technician]", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "senior_technician",
        activeShiftRole: "senior_technician",
        clinicalRole: "senior_technician",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies technician when allow=[vet]", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "technician",
        activeShiftRole: "technician",
        clinicalRole: "technician",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      code: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
    });
  });

  it("denies when effectiveClinicalRole is null and no transitional option", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireClinicalAuthority — identity admin bypass", () => {
  it("denies identity admin when allowSystemAdmin=false", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: null,
        systemRole: "Admin",
        reason: "LEGACY_ADMIN_NO_CLINICAL",
      }),
    );
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "admin" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("allows identity admin when allowSystemAdmin=true and populates snapshot", async () => {
    const snap = makeSnapshot({
      effectiveClinicalRole: null,
      clinicalRole: null,
      systemRole: "Admin",
      reason: "LEGACY_ADMIN_NO_CLINICAL",
    });
    resolveAuthorityMock.mockResolvedValue(snap);
    const mw = requireClinicalAuthority({
      allow: ["vet"],
      allowSystemAdmin: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "admin" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(
      (req as { authoritySnapshot?: AuthoritySnapshot }).authoritySnapshot,
    ).toEqual(snap);
  });

  it("denies even when secondaryRole='admin' (no secondaryRole bypass)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "technician",
        activeShiftRole: "technician",
        clinicalRole: "technician",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq({
      authUser: {
        ...(makeReq().authUser as object),
        role: "technician",
        secondaryRole: "admin",
      },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireClinicalAuthority — dispense transitional fallback", () => {
  it("allows when option=true, effectiveClinicalRole=null, clinicalRole=vet, reason=EZSHIFT_NONE", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows technician permanent role under transitional fallback", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "technician",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("denies when reason=RESOLUTION_ERROR", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "RESOLUTION_ERROR",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies when reason=SHIFT_ROLE_NOT_CLINICAL", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "SHIFT_ROLE_NOT_CLINICAL",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies student permanent role under transitional fallback", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "student",
        reason: "STUDENT_NEVER_ELEVATED",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "student" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies admin (clinicalRole=null) under transitional fallback", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: null,
        systemRole: "Admin",
        reason: "LEGACY_ADMIN_NO_CLINICAL",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "admin" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies when clinicalRole not in allow[] under transitional fallback", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "technician",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies PR 7 CHECKED_IN_STALE even with transitional fallback ON (no resurrection)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "CHECKED_IN_STALE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies PR 7 CHECKED_IN_OPROLE_REVOKED even with transitional fallback ON (no resurrection)", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "CHECKED_IN_OPROLE_REVOKED",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies when transitional fallback OFF, effectiveClinicalRole=null, clinicalRole=vet, reason=EZSHIFT_NONE", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "EZSHIFT_NONE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: "vet" },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireClinicalAuthority — emergency break-glass (Code Blue initiation)", () => {
  const EMERGENCY_ALLOW: ActiveShiftRole[] = [
    "vet",
    "senior_technician",
    "technician",
  ];

  async function runEmergencyGate(
    snapshot: AuthoritySnapshot,
    identityRole: string,
    opts: { flag: boolean; allow?: ActiveShiftRole[] } = { flag: true },
  ): Promise<{ next: ReturnType<typeof vi.fn>; res: FakeRes }> {
    resolveAuthorityMock.mockResolvedValue(snapshot);
    const mw = requireClinicalAuthority({
      allow: opts.allow ?? EMERGENCY_ALLOW,
      ...(opts.flag ? { allowPermanentClinicalRoleForEmergency: true } : {}),
    });
    const req = makeReq({
      authUser: { ...(makeReq().authUser as object), role: identityRole },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    return { next, res };
  }

  it("allows a vet identity with no active shift (effectiveClinicalRole=null, reason=EZSHIFT_NONE)", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "EZSHIFT_NONE",
      }),
      "vet",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("allows a technician identity with no active shift", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "technician",
        reason: "EZSHIFT_NONE",
      }),
      "technician",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("allows a senior_technician identity with no active shift", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "senior_technician",
        reason: "EZSHIFT_NONE",
      }),
      "senior_technician",
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it("denies a student with no active shift — never elevated (clinicalRole=student, reason=EZSHIFT_NONE)", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "student",
        reason: "EZSHIFT_NONE",
      }),
      "student",
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      code: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
    });
  });

  it("denies the SAME null/EZSHIFT_NONE snapshot on a gate WITHOUT the emergency flag (scope proof — existing gates unchanged)", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "EZSHIFT_NONE",
      }),
      "vet",
      { flag: false },
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      code: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
    });
  });

  it("denies when reason is not EZSHIFT_NONE even with the emergency flag (no stale/revoked resurrection)", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "vet",
        reason: "CHECKED_IN_STALE",
      }),
      "vet",
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("denies when the permanent clinicalRole is not in allow[] under the emergency flag", async () => {
    const { next, res } = await runEmergencyGate(
      makeSnapshot({
        effectiveClinicalRole: null,
        clinicalRole: "technician",
        reason: "EZSHIFT_NONE",
      }),
      "technician",
      { flag: true, allow: ["vet"] },
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe("requireClinicalAuthority — snapshot propagation", () => {
  it("populates req.authoritySnapshot on allow path", async () => {
    const snap = makeSnapshot({
      effectiveClinicalRole: "vet",
      activeShiftRole: "vet",
      clinicalRole: "vet",
      source: "shift",
      reason: "EZSHIFT_ACTIVE",
    });
    resolveAuthorityMock.mockResolvedValue(snap);
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(
      (req as { authoritySnapshot?: AuthoritySnapshot }).authoritySnapshot,
    ).toEqual(snap);
  });

  it("populates req.authoritySnapshot on deny path", async () => {
    const snap = makeSnapshot({
      effectiveClinicalRole: "technician",
      activeShiftRole: "technician",
      clinicalRole: "technician",
      source: "shift",
      reason: "EZSHIFT_ACTIVE",
    });
    resolveAuthorityMock.mockResolvedValue(snap);
    const mw = requireClinicalAuthority({ allow: ["vet"] });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(
      (req as { authoritySnapshot?: AuthoritySnapshot }).authoritySnapshot,
    ).toEqual(snap);
  });
});

describe("requireClinicalAuthority — resolver invocation contract", () => {
  it("calls resolveAuthority with secondaryRole:null even when req.authUser.secondaryRole='admin'", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "technician",
        activeShiftRole: "technician",
        clinicalRole: "technician",
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
      }),
    );
    const mw = requireClinicalAuthority({
      allow: ["vet", "senior_technician", "technician"],
    });
    const req = makeReq({
      authUser: {
        ...(makeReq().authUser as object),
        role: "technician",
        secondaryRole: "admin",
      },
    });
    const res = makeRes();
    const next = vi.fn();
    await mw(req as never, res as never, next);
    expect(resolveAuthorityMock).toHaveBeenCalledTimes(1);
    const callArg = resolveAuthorityMock.mock.calls[0]![0] as {
      authUser: { secondaryRole: unknown };
    };
    expect(callArg.authUser.secondaryRole).toBeNull();
  });
});
