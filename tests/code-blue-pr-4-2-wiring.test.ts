/**
 * Phase 4 PR 4.2 — Code Blue manager wiring helper unit tests.
 *
 * Exercises `loadCodeBlueManagerLookup` and `evaluateCodeBlueManagerForRoute`
 * with mocked db and resolveAuthority. Pure unit tests — no Express, no
 * network, no real DB.
 *
 * Asserts the master plan §5 invariants:
 *   - Loads vt_users by id, clinic-scoped via the request's clinicId.
 *   - Never reads req.authoritySnapshot (structural: helper takes no req).
 *   - Cross-clinic guard precedes resolveAuthority.
 *   - Resolver throw → fail-open via "resolver_fault" lookup kind.
 *   - DB throw on user load → "resolver_fault" (defensive, not user_missing).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock db before importing the wiring module.
const dbSelectMock = vi.fn();
vi.mock("../server/db.js", () => ({
  db: {
    select: (...args: unknown[]) => dbSelectMock(...args),
  },
  users: {
    id: "users.id",
    clinicId: "users.clinicId",
    name: "users.name",
    role: "users.role",
    deletedAt: "users.deletedAt",
  },
  auditLogs: {},
  eventOutbox: {},
}));

const resolveAuthorityMock = vi.fn();
vi.mock("../server/lib/authority.js", () => ({
  resolveAuthority: (input: unknown) => resolveAuthorityMock(input),
}));

import {
  evaluateCodeBlueManagerForRoute,
  loadCodeBlueManagerLookup,
} from "../server/lib/authority/code-blue-manager.wiring.js";
import { resetMetrics, getMetricsSnapshot } from "../server/lib/metrics.js";

const FIXED_NOW = new Date("2026-05-15T12:00:00.000Z");

function mockUserRow(overrides: Record<string, unknown> = {}) {
  const row = {
    id: "manager-1",
    clinicId: "clinic-1",
    name: "Dr. Vet",
    role: "vet",
    deletedAt: null,
    ...overrides,
  };
  dbSelectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [row],
      }),
    }),
  }));
}

function mockNoUserRow() {
  dbSelectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  }));
}

function mockDbThrow() {
  dbSelectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          throw new Error("db blip");
        },
      }),
    }),
  }));
}

function snapshotOk() {
  return {
    systemRole: "User",
    clinicalRole: "vet",
    activeShiftRole: "vet",
    operationalRole: "senior_lead",
    effectiveClinicalRole: "vet",
    source: "check_in",
    reason: "CHECKED_IN",
    resolvedAt: FIXED_NOW.toISOString(),
  };
}

beforeEach(() => {
  resetMetrics();
  dbSelectMock.mockReset();
  resolveAuthorityMock.mockReset();
  delete process.env.AUTHORITY_OBS_V1;
  delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
});

afterEach(() => {
  resetMetrics();
});

// ─────────────────────────────────────────────────────────────────────────────
// loadCodeBlueManagerLookup

describe("loadCodeBlueManagerLookup — happy path", () => {
  it("returns { kind: 'snapshot', snapshot } when target exists in clinic and resolver succeeds", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    const lookup = await loadCodeBlueManagerLookup({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(lookup.kind).toBe("snapshot");
    if (lookup.kind === "snapshot") {
      expect(lookup.snapshot.operationalRole).toBe("senior_lead");
    }
  });

  it("invokes resolveAuthority with target user fields built from DB (NOT from req.authoritySnapshot)", async () => {
    mockUserRow({ id: "manager-7", name: "Dr. Ward", role: "vet" });
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    await loadCodeBlueManagerLookup({
      clinicId: "clinic-1",
      managerUserId: "manager-7",
      now: FIXED_NOW,
    });
    expect(resolveAuthorityMock).toHaveBeenCalledTimes(1);
    const arg = resolveAuthorityMock.mock.calls[0][0];
    expect(arg.authUser).toEqual({
      id: "manager-7",
      name: "Dr. Ward",
      role: "vet",
      secondaryRole: null, // Phase 2B: never propagate secondaryRole
    });
    expect(arg.clinicId).toBe("clinic-1");
    expect(arg.now).toBe(FIXED_NOW);
  });
});

describe("loadCodeBlueManagerLookup — missing target", () => {
  it("returns user_missing when DB returns no rows", async () => {
    mockNoUserRow();
    const lookup = await loadCodeBlueManagerLookup({
      clinicId: "clinic-1",
      managerUserId: "ghost",
      now: FIXED_NOW,
    });
    expect(lookup).toEqual({ kind: "user_missing" });
    expect(resolveAuthorityMock).not.toHaveBeenCalled();
  });
});

describe("loadCodeBlueManagerLookup — cross-clinic", () => {
  it("returns cross_clinic when target row's clinicId mismatches request clinicId", async () => {
    mockUserRow({ clinicId: "clinic-elsewhere" });
    const lookup = await loadCodeBlueManagerLookup({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(lookup).toEqual({ kind: "cross_clinic" });
    expect(resolveAuthorityMock).not.toHaveBeenCalled();
  });
});

describe("loadCodeBlueManagerLookup — fail-open posture", () => {
  it("DB throw → resolver_fault (defensive, not user_missing)", async () => {
    mockDbThrow();
    const lookup = await loadCodeBlueManagerLookup({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(lookup).toEqual({ kind: "resolver_fault" });
    expect(resolveAuthorityMock).not.toHaveBeenCalled();
  });

  it("resolveAuthority throw → resolver_fault", async () => {
    mockUserRow();
    resolveAuthorityMock.mockRejectedValue(new Error("resolver blip"));
    const lookup = await loadCodeBlueManagerLookup({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      now: FIXED_NOW,
    });
    expect(lookup).toEqual({ kind: "resolver_fault" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateCodeBlueManagerForRoute

describe("evaluateCodeBlueManagerForRoute — shadow-mode observability", () => {
  beforeEach(() => {
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
  });
  afterEach(() => {
    delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
  });

  it("eligible manager → allow with ALLOWLIST_OK + allow counter", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "initiation",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({ action: "allow", protected: "ALLOWLIST_OK" });
    expect(result.lookupKind).toBe("snapshot");
    expect(getMetricsSnapshot().codeBlue.manager.allow).toBeGreaterThanOrEqual(1);
  });

  it("ineligible operational role → allow + shadow_denied counter (shadow never blocks)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue({
      ...snapshotOk(),
      operationalRole: "night_admission_only",
    });
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "initiation",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({ action: "allow", protected: "SHADOW_WOULD_HAVE_DENIED" });
    expect(
      getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.oproleNotInAllowlist,
    ).toBeGreaterThanOrEqual(1);
  });

  it("cross_clinic lookup → allow + manager_cross_clinic counter (shadow)", async () => {
    mockUserRow({ clinicId: "clinic-elsewhere" });
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "initiation",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({ action: "allow", protected: "SHADOW_WOULD_HAVE_DENIED" });
    expect(result.lookupKind).toBe("cross_clinic");
    expect(
      getMetricsSnapshot().codeBlue.manager.shadowWouldHaveDenied.managerCrossClinic,
    ).toBeGreaterThanOrEqual(1);
  });

  it("resolver fault → allow + FAULT_OPEN + faultOpen counter (fail-open in shadow)", async () => {
    mockUserRow();
    resolveAuthorityMock.mockRejectedValue(new Error("breaker open"));
    const result = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "initiation",
      now: FIXED_NOW,
    });
    expect(result.verdict).toEqual({ action: "allow", protected: "FAULT_OPEN" });
    expect(result.lookupKind).toBe("resolver_fault");
    expect(getMetricsSnapshot().codeBlue.manager.faultOpen).toBeGreaterThanOrEqual(1);
  });
});

describe("evaluateCodeBlueManagerForRoute — endpoint flows through", () => {
  it("passes the endpoint to the evaluator (init vs end)", async () => {
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
    mockUserRow();
    resolveAuthorityMock.mockResolvedValue(snapshotOk());
    const init = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "initiation",
      now: FIXED_NOW,
    });
    const end = await evaluateCodeBlueManagerForRoute({
      clinicId: "clinic-1",
      managerUserId: "manager-1",
      endpoint: "end",
      now: FIXED_NOW,
    });
    expect(init.verdict.action).toBe("allow");
    expect(end.verdict.action).toBe("allow");
  });
});
