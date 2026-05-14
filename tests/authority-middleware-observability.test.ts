/**
 * Phase 2.5 PR 5: requireClinicalAuthority observability assertions.
 *
 * Validates the additive instrumentation wired into the middleware:
 *  - resolution-source counters increment on every successful authority
 *    resolution
 *  - denial counters increment on each denial branch
 *  - legacy_fallback_used counter increments when fallback admits
 *  - denial audit is emitted alongside recordAccessDenied when AUTHORITY_OBS_V1
 *    is on; suppressed when off
 *  - resolver-error catch path increments authority_resolution_failed counter
 *    and emits the audit when the flag is on; silent when off
 *  - response status/body shape is unchanged in both flag states
 *
 * Pure unit tests. No DB, no Express boot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveShiftRole,
  AuthorityReason,
  AuthoritySnapshot,
  ClinicalRole,
} from "../shared/authority.js";

const resolveAuthorityMock = vi.fn<
  (input: unknown) => Promise<AuthoritySnapshot>
>();
const emitDeniedMock = vi.fn();
const emitResolutionFailedMock = vi.fn();
const emitLegacyFallbackMock = vi.fn();
const recordAccessDeniedMock = vi.fn();

vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));
vi.mock("../server/lib/authority-audit.js", () => ({
  emitAuthorityDeniedAudit: (...args: unknown[]) => emitDeniedMock(...args),
  emitAuthorityResolutionFailedAudit: (...args: unknown[]) =>
    emitResolutionFailedMock(...args),
  emitDispenseLegacyFallbackAudit: (...args: unknown[]) =>
    emitLegacyFallbackMock(...args),
}));
vi.mock("../server/lib/access-denied.js", () => ({
  recordAccessDenied: (...args: unknown[]) => recordAccessDeniedMock(...args),
}));
vi.mock("../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
}));

import { requireClinicalAuthority } from "../server/middleware/authority.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

type FakeRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  getHeader: ReturnType<typeof vi.fn>;
  statusCode?: number;
  body?: unknown;
};

function makeRes(): FakeRes {
  const res: FakeRes = {
    status: vi.fn(),
    json: vi.fn(),
    getHeader: vi.fn().mockReturnValue(undefined),
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
    originalUrl: "/api/dispense/draft",
    path: "/api/dispense/draft",
    method: "POST",
    authUser: {
      id: "user-1",
      name: "Test User",
      role: "technician",
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

const originalFlag = process.env.AUTHORITY_OBS_V1;

beforeEach(() => {
  resolveAuthorityMock.mockReset();
  emitDeniedMock.mockReset();
  emitResolutionFailedMock.mockReset();
  emitLegacyFallbackMock.mockReset();
  recordAccessDeniedMock.mockReset();
  resetMetrics();
});

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.AUTHORITY_OBS_V1;
  } else {
    process.env.AUTHORITY_OBS_V1 = originalFlag;
  }
});

describe("requireClinicalAuthority observability — resolution source counters", () => {
  it("increments authority_resolution_source_check_in on a check-in snapshot", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "technician",
        reason: "CHECKED_IN",
        source: "check_in",
      }),
    );
    const next = vi.fn();
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(getMetricsSnapshot().authority.resolutionSource.checkIn).toBe(1);
  });

  it("increments authority_resolution_source_shift on a shift snapshot", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "technician",
        reason: "EZSHIFT_ACTIVE",
        source: "shift",
      }),
    );
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      vi.fn(),
    );
    expect(getMetricsSnapshot().authority.resolutionSource.shift).toBe(1);
  });

  it("increments authority_resolution_source_no_active_shift on a no_active_shift snapshot", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
      }),
    );
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      vi.fn(),
    );
    expect(
      getMetricsSnapshot().authority.resolutionSource.noActiveShift,
    ).toBe(1);
  });
});

describe("requireClinicalAuthority observability — denial counters and audit", () => {
  it("denies with ROLE_NOT_IN_ALLOW counter when fallback is not requested", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "technician",
      }),
    );
    const res = makeRes();
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(403);
    expect(recordAccessDeniedMock).toHaveBeenCalledTimes(1);
    expect(getMetricsSnapshot().authority.denied.roleNotInAllow).toBe(1);
    expect(getMetricsSnapshot().authority.denied.legacyFallbackNotMatched).toBe(0);
  });

  it("denies with LEGACY_FALLBACK_NOT_MATCHED counter when fallback was actually attempted (null effective role + EZSHIFT_NONE) but the permanent-role test failed", async () => {
    // Fallback was reachable (effectiveClinicalRole === null, reason ===
    // EZSHIFT_NONE) but the permanent clinicalRole ("vet") is not in the
    // route's allow list (["technician"]). This is the only scenario where
    // LEGACY_FALLBACK_NOT_MATCHED is the correct classification.
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "vet",
      }),
    );
    const res = makeRes();
    await requireClinicalAuthority({
      allow: ["technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    })(makeReq() as never, res as never, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(
      getMetricsSnapshot().authority.denied.legacyFallbackNotMatched,
    ).toBe(1);
    expect(getMetricsSnapshot().authority.denied.roleNotInAllow).toBe(0);
  });

  it("denies with ROLE_NOT_IN_ALLOW counter when fallback is opted but the fallback branch was never reachable (non-null effective role not in allow)", async () => {
    // Even with fallback opted in, a user whose effectiveClinicalRole is
    // present (just not in allow) NEVER enters the fallback branch — the
    // first condition (effectiveClinicalRole === null) short-circuits.
    // The denial belongs in ROLE_NOT_IN_ALLOW, not LEGACY_FALLBACK_NOT_MATCHED.
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: "vet",
        reason: "EZSHIFT_ACTIVE",
        source: "shift",
        clinicalRole: "vet",
      }),
    );
    const res = makeRes();
    await requireClinicalAuthority({
      allow: ["technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    })(makeReq() as never, res as never, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(getMetricsSnapshot().authority.denied.roleNotInAllow).toBe(1);
    expect(
      getMetricsSnapshot().authority.denied.legacyFallbackNotMatched,
    ).toBe(0);
  });

  it("denies with ROLE_NOT_IN_ALLOW counter when fallback is opted but reason is not EZSHIFT_NONE (e.g., SHIFT_ROLE_NOT_CLINICAL)", async () => {
    // Another fallback-opted scenario where the fallback branch is
    // unreachable: effectiveClinicalRole is null but the reason is not
    // EZSHIFT_NONE, so the fallback's reason check short-circuits. Classify
    // as ROLE_NOT_IN_ALLOW since the fallback was never attempted.
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "SHIFT_ROLE_NOT_CLINICAL",
        source: "no_active_shift",
        clinicalRole: "technician",
      }),
    );
    const res = makeRes();
    await requireClinicalAuthority({
      allow: ["technician"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    })(makeReq() as never, res as never, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(getMetricsSnapshot().authority.denied.roleNotInAllow).toBe(1);
    expect(
      getMetricsSnapshot().authority.denied.legacyFallbackNotMatched,
    ).toBe(0);
  });

  it("emits denial audit when AUTHORITY_OBS_V1 is on (audit helper called)", async () => {
    process.env.AUTHORITY_OBS_V1 = "true";
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "technician",
      }),
    );
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      vi.fn(),
    );
    expect(emitDeniedMock).toHaveBeenCalledTimes(1);
    const args = emitDeniedMock.mock.calls[0]![0] as { denialKind: string };
    expect(args.denialKind).toBe("ROLE_NOT_IN_ALLOW");
  });

  it("invokes denial-audit emit even when flag is off (emit helper itself decides to no-op)", async () => {
    // The flag gate lives inside authority-audit.ts. The middleware always
    // calls the emit helper; the helper no-ops when the flag is off. This
    // keeps the middleware free of branching on observability state.
    delete process.env.AUTHORITY_OBS_V1;
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "technician",
      }),
    );
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      vi.fn(),
    );
    expect(emitDeniedMock).toHaveBeenCalledTimes(1);
  });
});

describe("requireClinicalAuthority observability — legacy fallback grant path", () => {
  it("counter increments and emit helper is called when fallback admits", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "vet",
      }),
    );
    const next = vi.fn();
    await requireClinicalAuthority({
      allow: ["vet"],
      allowPermanentClinicalRoleFallbackForLegacyDispense: true,
    })(makeReq() as never, makeRes() as never, next);
    expect(next).toHaveBeenCalled();
    expect(getMetricsSnapshot().authority.legacyFallbackUsed).toBe(1);
    expect(emitLegacyFallbackMock).toHaveBeenCalledTimes(1);
  });
});

describe("requireClinicalAuthority observability — resolver-error catch path", () => {
  it("increments authority_resolution_failed counter and returns 500 with unchanged body shape", async () => {
    resolveAuthorityMock.mockRejectedValue(new Error("kaboom"));
    const res = makeRes();
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "AUTHORITY_RESOLUTION_FAILED",
      message: "Authority resolution failed",
      requestId: "req-test-1",
    });
    expect(getMetricsSnapshot().authority.resolutionFailed).toBe(1);
  });

  it("logs to console.error and emits audit when flag is on", async () => {
    process.env.AUTHORITY_OBS_V1 = "true";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveAuthorityMock.mockRejectedValue(new Error("kaboom"));
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      vi.fn(),
    );
    expect(errSpy).toHaveBeenCalled();
    expect(emitResolutionFailedMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("does not log to console.error when flag is off (emit helper still called; it no-ops internally)", async () => {
    delete process.env.AUTHORITY_OBS_V1;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resolveAuthorityMock.mockRejectedValue(new Error("kaboom"));
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      makeRes() as never,
      vi.fn(),
    );
    expect(errSpy).not.toHaveBeenCalled();
    // The middleware always calls the emit helper; the helper's no-op when
    // flag is off is asserted in tests/authority-audit.test.ts.
    expect(emitResolutionFailedMock).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});

describe("requireClinicalAuthority observability — response shape invariant", () => {
  it("denial 403 body shape unchanged when flag is on vs off", async () => {
    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "technician",
      }),
    );
    const resOff = makeRes();
    delete process.env.AUTHORITY_OBS_V1;
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      resOff as never,
      vi.fn(),
    );

    resolveAuthorityMock.mockResolvedValue(
      makeSnapshot({
        effectiveClinicalRole: null,
        reason: "EZSHIFT_NONE",
        source: "no_active_shift",
        clinicalRole: "technician",
      }),
    );
    const resOn = makeRes();
    process.env.AUTHORITY_OBS_V1 = "true";
    await requireClinicalAuthority({ allow: ["technician"] })(
      makeReq() as never,
      resOn as never,
      vi.fn(),
    );

    expect(resOff.body).toEqual(resOn.body);
    expect(resOff.statusCode).toBe(resOn.statusCode);
  });
});
