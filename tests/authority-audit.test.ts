/**
 * Phase 2.5 PR 5: Unit tests for server/lib/authority-audit.ts.
 *
 * Pure unit tests with logAudit mocked. No DB, no Express boot. Asserts:
 *  - Flag-off → no logAudit call (no-op).
 *  - Flag-on  → exactly one logAudit call with the expected actionType and
 *    metadata shape.
 *  - Rate-limit per (clinicId, userId, route) — second emission within window
 *    suppressed.
 *  - Missing clinicId → no emission (safe-skip).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { AuthoritySnapshot } from "../shared/authority.js";

const logAuditMock = vi.fn();
vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => logAuditMock(...args),
}));

// Prevent server/db.ts from being touched by the import chain.
vi.mock("../server/db.js", () => ({
  db: {},
  auditLogs: {},
  eventOutbox: {},
}));

import {
  emitAuthorityDeniedAudit,
  emitAuthorityResolutionFailedAudit,
  emitCodeBlueBreakGlassAudit,
  emitDispenseLegacyFallbackAudit,
} from "../server/lib/authority-audit.js";

const originalFlag = process.env.AUTHORITY_OBS_V1;

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: { "x-request-id": "req-test-1" },
    clinicId: "c1",
    originalUrl: "/api/dispense/draft",
    path: "/api/dispense/draft",
    method: "POST",
    authUser: {
      id: "user-1",
      email: "u@example.com",
      role: "technician",
      clinicId: "c1",
    },
    ...overrides,
  } as unknown as Request;
}

function makeSnapshot(
  overrides: Partial<AuthoritySnapshot> = {},
): AuthoritySnapshot {
  return {
    systemRole: "User",
    clinicalRole: "technician",
    activeShiftRole: null,
    operationalRole: null,
    effectiveClinicalRole: null,
    source: "no_active_shift",
    reason: "EZSHIFT_NONE",
    resolvedAt: "2026-05-14T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  logAuditMock.mockReset();
});

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.AUTHORITY_OBS_V1;
  } else {
    process.env.AUTHORITY_OBS_V1 = originalFlag;
  }
});

describe("authority-audit — flag-off no-op", () => {
  beforeEach(() => {
    delete process.env.AUTHORITY_OBS_V1;
  });

  it("emitAuthorityDeniedAudit does nothing when flag is unset", () => {
    emitAuthorityDeniedAudit({
      req: makeReq(),
      snapshot: makeSnapshot(),
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("emitAuthorityResolutionFailedAudit does nothing when flag is unset", () => {
    emitAuthorityResolutionFailedAudit({
      req: makeReq(),
      error: new Error("boom"),
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("emitDispenseLegacyFallbackAudit does nothing when flag is unset", () => {
    emitDispenseLegacyFallbackAudit({
      req: makeReq(),
      snapshot: makeSnapshot(),
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("emitCodeBlueBreakGlassAudit does nothing when flag is unset", () => {
    emitCodeBlueBreakGlassAudit({
      req: makeReq(),
      snapshot: makeSnapshot(),
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });

  it("emitAuthorityDeniedAudit does nothing when flag is 'false'", () => {
    process.env.AUTHORITY_OBS_V1 = "false";
    emitAuthorityDeniedAudit({
      req: makeReq(),
      snapshot: makeSnapshot(),
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});

describe("authority-audit — flag-on emission", () => {
  beforeEach(() => {
    process.env.AUTHORITY_OBS_V1 = "true";
  });

  it("emitAuthorityDeniedAudit writes an authority_denied audit row with snapshot metadata", () => {
    emitAuthorityDeniedAudit({
      req: makeReq({ clinicId: "c-denied-1" } as Partial<Request>),
      snapshot: makeSnapshot({
        effectiveClinicalRole: "technician",
        reason: "EZSHIFT_ACTIVE",
        source: "shift",
      }),
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0]![0] as {
      actionType: string;
      clinicId: string;
      performedBy: string;
      targetType: string | null;
      metadata: Record<string, unknown>;
      actorRole?: string | null;
    };
    expect(call.actionType).toBe("authority_denied");
    expect(call.clinicId).toBe("c-denied-1");
    expect(call.performedBy).toBe("user-1");
    expect(call.targetType).toBe("authority_decision");
    expect(call.metadata.denialKind).toBe("ROLE_NOT_IN_ALLOW");
    expect(call.metadata.snapshotReason).toBe("EZSHIFT_ACTIVE");
    expect(call.metadata.snapshotSource).toBe("shift");
    expect(call.metadata.route).toBe("/api/dispense/draft");
    expect(call.metadata.method).toBe("POST");
    expect(call.actorRole).toBe("technician");
  });

  it("emitAuthorityResolutionFailedAudit writes an authority_resolution_failed audit row", () => {
    emitAuthorityResolutionFailedAudit({
      req: makeReq({ clinicId: "c-fail-1" } as Partial<Request>),
      error: new Error("db timeout"),
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0]![0] as {
      actionType: string;
      metadata: Record<string, unknown>;
    };
    expect(call.actionType).toBe("authority_resolution_failed");
    expect(call.metadata.error).toBe("db timeout");
  });

  it("emitDispenseLegacyFallbackAudit writes a dispense_legacy_role_fallback_used audit row", () => {
    emitDispenseLegacyFallbackAudit({
      req: makeReq({ clinicId: "c-fb-1" } as Partial<Request>),
      snapshot: makeSnapshot({ clinicalRole: "vet" }),
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0]![0] as {
      actionType: string;
      metadata: Record<string, unknown>;
      actorRole?: string | null;
    };
    expect(call.actionType).toBe("dispense_legacy_role_fallback_used");
    expect(call.metadata.clinicalRole).toBe("vet");
    expect(call.actorRole).toBe("vet");
  });

  it("emitCodeBlueBreakGlassAudit writes a code_blue_break_glass_used audit row", () => {
    emitCodeBlueBreakGlassAudit({
      req: makeReq({
        clinicId: "c-bg-1",
        originalUrl: "/api/code-blue/sessions",
        path: "/api/code-blue/sessions",
      } as Partial<Request>),
      snapshot: makeSnapshot({ clinicalRole: "vet" }),
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0]![0] as {
      actionType: string;
      clinicId: string;
      targetType: string | null;
      metadata: Record<string, unknown>;
      actorRole?: string | null;
    };
    expect(call.actionType).toBe("code_blue_break_glass_used");
    expect(call.clinicId).toBe("c-bg-1");
    expect(call.targetType).toBe("authority_decision");
    expect(call.metadata.route).toBe("/api/code-blue/sessions");
    expect(call.metadata.snapshotReason).toBe("EZSHIFT_NONE");
    expect(call.metadata.clinicalRole).toBe("vet");
    expect(call.actorRole).toBe("vet");
  });

  it("rate-limits emitAuthorityDeniedAudit within window — same (clinicId, userId, route) suppressed on second call", () => {
    const req = makeReq({ clinicId: "c-rl-1" } as Partial<Request>);
    const snap = makeSnapshot();
    emitAuthorityDeniedAudit({ req, snapshot: snap, denialKind: "ROLE_NOT_IN_ALLOW" });
    emitAuthorityDeniedAudit({ req, snapshot: snap, denialKind: "ROLE_NOT_IN_ALLOW" });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("rate-limit is keyed on (clinicId, userId, route) — different route triggers a separate emission", () => {
    const snap = makeSnapshot();
    emitAuthorityDeniedAudit({
      req: makeReq({
        clinicId: "c-rl-2",
        originalUrl: "/api/dispense/draft",
        path: "/api/dispense/draft",
      } as Partial<Request>),
      snapshot: snap,
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    emitAuthorityDeniedAudit({
      req: makeReq({
        clinicId: "c-rl-2",
        originalUrl: "/api/dispense/confirm",
        path: "/api/dispense/confirm",
      } as Partial<Request>),
      snapshot: snap,
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    expect(logAuditMock).toHaveBeenCalledTimes(2);
  });

  it("query string is stripped from the rate-limit key — /x?a=1 and /x?a=2 collapse into the same dedupe bucket", () => {
    const snap = makeSnapshot();
    emitAuthorityDeniedAudit({
      req: makeReq({
        clinicId: "c-rl-qs",
        originalUrl: "/api/dispense/draft?a=1",
        path: "/api/dispense/draft",
      } as Partial<Request>),
      snapshot: snap,
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    emitAuthorityDeniedAudit({
      req: makeReq({
        clinicId: "c-rl-qs",
        originalUrl: "/api/dispense/draft?a=2",
        path: "/api/dispense/draft",
      } as Partial<Request>),
      snapshot: snap,
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    // Exactly one audit row — the second call hit the same (clinicId,
    // userId, normalized-route) bucket as the first and was suppressed.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
  });

  it("audit metadata.route is the path-only form (no query string)", () => {
    emitAuthorityDeniedAudit({
      req: makeReq({
        clinicId: "c-md-qs",
        originalUrl: "/api/dispense/draft?patientId=secret",
        path: "/api/dispense/draft",
      } as Partial<Request>),
      snapshot: makeSnapshot(),
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const call = logAuditMock.mock.calls[0]![0] as {
      metadata: Record<string, unknown>;
    };
    expect(call.metadata.route).toBe("/api/dispense/draft");
  });

  it("safe-skips emission when clinicId is missing", () => {
    emitAuthorityDeniedAudit({
      req: makeReq({ clinicId: undefined, authUser: undefined } as Partial<Request>),
      snapshot: makeSnapshot(),
      denialKind: "ROLE_NOT_IN_ALLOW",
    });
    expect(logAuditMock).not.toHaveBeenCalled();
  });
});
