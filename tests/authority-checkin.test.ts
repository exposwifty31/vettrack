/**
 * Phase 2.5 PR 3: Unit tests for resolveAuthority() check-in path.
 *
 * Pure unit tests with resolveCurrentRole AND getOpenClinicalCheckIn mocked.
 * No DB, no Express boot, no network.
 *
 * Companion to tests/authority.test.ts. Kept in a separate file so the
 * pre-PR-3 test suite stays untouched and the flag-on / flag-off behavioral
 * contract is asserted in one place.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveShiftSnapshot,
  RoleResolutionResult,
} from "../server/lib/role-resolution.js";
import type { OpenClinicalCheckInRow } from "../server/lib/check-in-resolution.js";

// ---------------------------------------------------------------------------
// Mock the legacy resolver and the check-in resolver
// ---------------------------------------------------------------------------
const resolveCurrentRoleMock = vi.fn<
  (input: unknown) => Promise<RoleResolutionResult>
>();
const getOpenClinicalCheckInMock = vi.fn<
  (input: unknown) => Promise<OpenClinicalCheckInRow | null>
>();

vi.mock("../server/lib/role-resolution.js", () => ({
  resolveCurrentRole: (input: unknown) => resolveCurrentRoleMock(input),
}));
vi.mock("../server/lib/check-in-resolution.js", () => ({
  getOpenClinicalCheckIn: (input: unknown) => getOpenClinicalCheckInMock(input),
}));

// Prevent server/db.ts from being touched by the import chain.
vi.mock("../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
  clinicalCheckIns: {},
}));

import { resolveAuthority } from "../server/lib/authority.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FIXED_NOW = new Date("2026-05-13T12:00:00.000Z");

function mockShiftResult(role: string, name = "Test User"): void {
  const activeShift: ActiveShiftSnapshot = {
    id: "shift-1",
    date: "2026-05-13",
    startTime: "08:00:00",
    endTime: "18:00:00",
    employeeName: name,
    role: role as ActiveShiftSnapshot["role"],
  };
  resolveCurrentRoleMock.mockResolvedValue({
    effectiveRole: role as RoleResolutionResult["effectiveRole"],
    permanentRole: "technician",
    source: "shift",
    activeShift,
    resolvedAt: FIXED_NOW,
  });
}

function mockNoShift(fallbackRole: string): void {
  resolveCurrentRoleMock.mockResolvedValue({
    effectiveRole: fallbackRole as RoleResolutionResult["effectiveRole"],
    permanentRole: fallbackRole as RoleResolutionResult["permanentRole"],
    source: "permanent",
    activeShift: null,
    resolvedAt: FIXED_NOW,
  });
}

function makeCheckInRow(overrides: Partial<OpenClinicalCheckInRow> = {}): OpenClinicalCheckInRow {
  return {
    id: "ci-1",
    clinicId: "c1",
    userId: "user-1",
    clinicalRoleAtCheckIn: "technician",
    operationalRole: "ward",
    checkedInAt: new Date("2026-05-13T08:00:00.000Z"),
    ...overrides,
  };
}

const baseUser = {
  id: "user-1",
  name: "Test User",
  role: "technician",
  secondaryRole: null as string | null,
};

let warnSpy: ReturnType<typeof vi.spyOn>;
const originalFlag = process.env.AUTHORITY_USE_CHECKIN_PATH;

beforeEach(() => {
  resolveCurrentRoleMock.mockReset();
  getOpenClinicalCheckInMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  if (originalFlag === undefined) {
    delete process.env.AUTHORITY_USE_CHECKIN_PATH;
  } else {
    process.env.AUTHORITY_USE_CHECKIN_PATH = originalFlag;
  }
});

// ---------------------------------------------------------------------------
// Flag off: existing behavior must be untouched
// ---------------------------------------------------------------------------

describe("resolveAuthority — AUTHORITY_USE_CHECKIN_PATH unset", () => {
  it("does not call getOpenClinicalCheckIn", async () => {
    delete process.env.AUTHORITY_USE_CHECKIN_PATH;
    mockNoShift("vet");
    await resolveAuthority({
      authUser: { ...baseUser, role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(getOpenClinicalCheckInMock).not.toHaveBeenCalled();
  });

  it("emits legacy EZSHIFT_NONE when no shift exists", async () => {
    delete process.env.AUTHORITY_USE_CHECKIN_PATH;
    mockNoShift("vet");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.source).toBe("no_active_shift");
    expect(snap.reason).toBe("EZSHIFT_NONE");
    expect(snap.operationalRole).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Flag on + no row: Strategy A — fall through to legacy
// ---------------------------------------------------------------------------

describe("resolveAuthority — flag on + no check-in row (Strategy A)", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
    getOpenClinicalCheckInMock.mockResolvedValue(null);
  });

  it("EZSHIFT_NONE snapshot equals the flag-off snapshot byte-for-byte", async () => {
    mockNoShift("vet");
    const flagOn = await resolveAuthority({
      authUser: { ...baseUser, role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    delete process.env.AUTHORITY_USE_CHECKIN_PATH;
    resolveCurrentRoleMock.mockReset();
    mockNoShift("vet");
    const flagOff = await resolveAuthority({
      authUser: { ...baseUser, role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    expect(flagOn).toEqual(flagOff);
  });

  it("EZSHIFT_ACTIVE snapshot equals the flag-off snapshot byte-for-byte", async () => {
    mockShiftResult("technician");
    const flagOn = await resolveAuthority({
      authUser: { ...baseUser, role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    delete process.env.AUTHORITY_USE_CHECKIN_PATH;
    resolveCurrentRoleMock.mockReset();
    mockShiftResult("technician");
    const flagOff = await resolveAuthority({
      authUser: { ...baseUser, role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    expect(flagOn).toEqual(flagOff);
  });

  it("SHIFT_ROLE_NOT_CLINICAL still emits when shift role is admin", async () => {
    mockShiftResult("admin");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.source).toBe("no_active_shift");
    expect(snap.reason).toBe("SHIFT_ROLE_NOT_CLINICAL");
    expect(snap.operationalRole).toBeNull();
  });

  it("LEGACY_ADMIN_NO_CLINICAL is preserved", async () => {
    mockNoShift("admin");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "admin" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.reason).toBe("LEGACY_ADMIN_NO_CLINICAL");
    expect(snap.operationalRole).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Flag on + open row: check-in authority wins
// ---------------------------------------------------------------------------

describe("resolveAuthority — flag on + open check-in row", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  });

  it("with operationalRole populated → source=check_in, reason=CHECKED_IN", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({ clinicalRoleAtCheckIn: "vet", operationalRole: "ward" }),
    );
    mockNoShift("vet");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.source).toBe("check_in");
    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
    expect(snap.operationalRole).toBe("ward");
  });

  it("with operationalRole null → source=check_in, reason=CHECKED_IN_NO_OPROLE", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        clinicalRoleAtCheckIn: "technician",
        operationalRole: null,
      }),
    );
    mockNoShift("technician");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.source).toBe("check_in");
    expect(snap.reason).toBe("CHECKED_IN_NO_OPROLE");
    expect(snap.effectiveClinicalRole).toBe("technician");
    expect(snap.operationalRole).toBeNull();
  });

  it("check-in clinicalRole is sticky: identity senior_technician + check-in as technician stays technician even with shift saying vet", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-monotonic-1",
        clinicalRoleAtCheckIn: "technician",
        operationalRole: "ward",
      }),
    );
    mockShiftResult("senior_technician");
    const snap = await resolveAuthority({
      authUser: {
        ...baseUser,
        id: "user-monotonic-1",
        role: "senior_technician",
      },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.clinicalRole).toBe("senior_technician");
    expect(snap.effectiveClinicalRole).toBe("technician");
    expect(snap.source).toBe("check_in");
    expect(snap.reason).toBe("CHECKED_IN");
  });

  it("activeShiftRole is populated from the observed shift when the shift lookup succeeds", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-activeshift-1",
        clinicalRoleAtCheckIn: "technician",
        operationalRole: "ward",
      }),
    );
    mockShiftResult("technician");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, id: "user-activeshift-1", role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.activeShiftRole).toBe("technician");
    expect(snap.source).toBe("check_in");
  });

  it("resolvedAt uses the same now passed in to resolveAuthority", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(makeCheckInRow());
    mockNoShift("technician");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.resolvedAt).toBe(FIXED_NOW.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

describe("resolveAuthority — drift detection", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  });

  it("emits checkin_shift_role_drift warning when shift role differs from check-in role", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-drift-1",
        clinicalRoleAtCheckIn: "technician",
        operationalRole: "ward",
      }),
    );
    mockShiftResult("senior_technician");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, id: "user-drift-1", role: "senior_technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.effectiveClinicalRole).toBe("technician"); // check-in wins
    expect(warnSpy).toHaveBeenCalled();
    const driftCalls = warnSpy.mock.calls.filter(
      (c) => c[0] === "[authority-drift]",
    );
    expect(driftCalls.length).toBeGreaterThanOrEqual(1);
    const payload = JSON.parse(driftCalls[0]![1] as string);
    expect(payload.event).toBe("checkin_shift_role_drift");
    expect(payload.checkInRole).toBe("technician");
    expect(payload.shiftRole).toBe("senior_technician");
    expect(payload.clinicId).toBe("c1");
    expect(payload.userId).toBe("user-drift-1");
  });

  it("does NOT emit drift warning when shift role matches check-in role", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-nodrift-1",
        clinicalRoleAtCheckIn: "technician",
        operationalRole: "ward",
      }),
    );
    mockShiftResult("technician");
    await resolveAuthority({
      authUser: { ...baseUser, id: "user-nodrift-1", role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    const driftCalls = warnSpy.mock.calls.filter(
      (c) =>
        c[0] === "[authority-drift]" &&
        typeof c[1] === "string" &&
        c[1].includes("checkin_shift_role_drift"),
    );
    expect(driftCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Asymmetric error containment
// ---------------------------------------------------------------------------

describe("resolveAuthority — asymmetric error containment", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  });

  it("check-in lookup DB error → RESOLUTION_ERROR (same contract as today's shift failure)", async () => {
    getOpenClinicalCheckInMock.mockRejectedValue(new Error("checkin db down"));
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.source).toBe("no_active_shift");
    expect(snap.reason).toBe("RESOLUTION_ERROR");
    expect(snap.effectiveClinicalRole).toBeNull();
    expect(snap.operationalRole).toBeNull();
    // Shift lookup must not be attempted after check-in failure.
    expect(resolveCurrentRoleMock).not.toHaveBeenCalled();
  });

  it("open check-in row + shift lookup DB error → check-in snapshot preserved, NOT RESOLUTION_ERROR", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-shifterr-1",
        clinicalRoleAtCheckIn: "vet",
        operationalRole: "ward",
      }),
    );
    resolveCurrentRoleMock.mockRejectedValue(new Error("shift db down"));
    const snap = await resolveAuthority({
      authUser: { ...baseUser, id: "user-shifterr-1", role: "vet" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.source).toBe("check_in");
    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
    expect(snap.operationalRole).toBe("ward");
    expect(snap.activeShiftRole).toBeNull();

    const driftCalls = warnSpy.mock.calls.filter(
      (c) =>
        c[0] === "[authority-drift]" &&
        typeof c[1] === "string" &&
        c[1].includes("checkin_shift_lookup_failed"),
    );
    expect(driftCalls.length).toBeGreaterThanOrEqual(1);
    const payload = JSON.parse(driftCalls[0]![1] as string);
    expect(payload.event).toBe("checkin_shift_lookup_failed");
    expect(payload.checkInRole).toBe("vet");
    expect(payload.shiftRole).toBeNull();
  });

  it("does not throw on shift lookup failure with an open check-in row", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-noThrow-1",
        clinicalRoleAtCheckIn: "vet",
        operationalRole: null,
      }),
    );
    resolveCurrentRoleMock.mockRejectedValue(new Error("kaboom"));
    await expect(
      resolveAuthority({
        authUser: { ...baseUser, id: "user-noThrow-1", role: "vet" },
        clinicId: "c1",
        now: FIXED_NOW,
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Student hard-stop precedence
// ---------------------------------------------------------------------------

describe("resolveAuthority — student hard-stop with flag on", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  });

  it("student with a stray open check-in row → STUDENT_NEVER_ELEVATED; check-in lookup never runs", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(
      makeCheckInRow({
        userId: "user-student-1",
        clinicalRoleAtCheckIn: "vet",
        operationalRole: "ward",
      }),
    );
    const snap = await resolveAuthority({
      authUser: { ...baseUser, id: "user-student-1", role: "student" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.clinicalRole).toBe("student");
    expect(snap.source).toBe("no_active_shift");
    expect(snap.reason).toBe("STUDENT_NEVER_ELEVATED");
    expect(snap.effectiveClinicalRole).toBeNull();
    expect(snap.operationalRole).toBeNull();
    expect(getOpenClinicalCheckInMock).not.toHaveBeenCalled();
    expect(resolveCurrentRoleMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Missing-name precedence
// ---------------------------------------------------------------------------

describe("resolveAuthority — missing-name with flag on", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  });

  it("blank name → MISSING_USER_NAME via legacy path; check-in lookup never runs", async () => {
    mockNoShift("vet");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "vet", name: "" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.reason).toBe("MISSING_USER_NAME");
    expect(getOpenClinicalCheckInMock).not.toHaveBeenCalled();
  });

  it("null name → MISSING_USER_NAME via legacy path; check-in lookup never runs", async () => {
    mockNoShift("vet");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "vet", name: null },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(snap.reason).toBe("MISSING_USER_NAME");
    expect(getOpenClinicalCheckInMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Snapshot shape — must remain the existing 8 keys
// ---------------------------------------------------------------------------

describe("resolveAuthority — snapshot shape with check-in", () => {
  beforeEach(() => {
    process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  });

  it("CHECKED_IN snapshot contains exactly the documented 8 fields", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(makeCheckInRow());
    mockNoShift("technician");
    const snap = await resolveAuthority({
      authUser: { ...baseUser, role: "technician" },
      clinicId: "c1",
      now: FIXED_NOW,
    });
    expect(Object.keys(snap).sort()).toEqual(
      [
        "activeShiftRole",
        "clinicalRole",
        "effectiveClinicalRole",
        "operationalRole",
        "reason",
        "resolvedAt",
        "source",
        "systemRole",
      ].sort(),
    );
    expect(snap).not.toHaveProperty("effectiveRole");
    expect(snap).not.toHaveProperty("permanentRole");
    expect(snap).not.toHaveProperty("secondaryRole");
    expect(snap).not.toHaveProperty("activeShift");
    expect(snap).not.toHaveProperty("checkInId");
  });
});
