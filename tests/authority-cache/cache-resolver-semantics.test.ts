/**
 * Phase 2.5 PR 6 — Resolver semantics under the cache layer.
 *
 * Verifies the load-bearing invariant: when AUTHORITY_CACHE_V1 === "true",
 * authority *decisions* remain byte-identical. Specifically:
 *
 *  - test #10: student hard-stop wins even with primed "vet" check-in entry
 *  - test #11: drift counter increments on every observation, not just misses
 *  - test #12: asymmetric error containment is preserved (cached check-in
 *              + thrown shift lookup still yields source="check_in")
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClinicalCheckInRow } from "../../server/lib/check-in-resolution.js";
import type { RoleResolutionResult } from "../../server/lib/role-resolution.js";

const getOpenClinicalCheckInMock = vi.fn<
  (input: unknown) => Promise<OpenClinicalCheckInRow | null>
>();
const resolveCurrentRoleMock = vi.fn<
  (input: unknown) => Promise<RoleResolutionResult>
>();

vi.mock("../../server/lib/check-in-resolution.js", () => ({
  getOpenClinicalCheckIn: (input: unknown) => getOpenClinicalCheckInMock(input),
}));

vi.mock("../../server/lib/role-resolution.js", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../server/lib/role-resolution.js")
  >();
  return {
    ...original,
    resolveCurrentRole: (input: unknown) => resolveCurrentRoleMock(input),
  };
});

vi.mock("../../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
  clinicalCheckIns: {},
}));

vi.mock("../../server/lib/clinic-timezone.js", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../server/lib/clinic-timezone.js")
  >();
  return {
    ...original,
    getClinicTimezone: vi.fn().mockResolvedValue("Asia/Jerusalem"),
  };
});

const { resolveAuthority } = await import("../../server/lib/authority.js");
const { __resetAuthorityCacheForTests } = await import(
  "../../server/lib/authority-cache.js"
);
const { resetMetrics, getMetricsSnapshot } = await import(
  "../../server/lib/metrics.js"
);

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

const baseUser = {
  id: "user-1",
  name: "Test User",
  role: "technician",
  secondaryRole: null,
};

beforeEach(() => {
  __resetAuthorityCacheForTests();
  resetMetrics();
  getOpenClinicalCheckInMock.mockReset();
  resolveCurrentRoleMock.mockReset();
  process.env.AUTHORITY_CACHE_V1 = "true";
  process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
});

describe("student hard-stop with cache on (test #10)", () => {
  it("returns STUDENT_NEVER_ELEVATED even with primed vet check-in entry", async () => {
    // Even if we somehow primed the cache with a vet check-in row for this
    // user, the student hard-stop must short-circuit BEFORE the check-in
    // lookup ever happens. We simulate by setting the mock to return a vet
    // check-in — the resolver should still return STUDENT_NEVER_ELEVATED.
    getOpenClinicalCheckInMock.mockResolvedValue({
      id: "ck-1",
      clinicId: "clinic-a",
      userId: "student-1",
      clinicalRoleAtCheckIn: "vet",
      operationalRole: "ward",
      checkedInAt: FIXED_NOW,
    });

    const snap = await resolveAuthority({
      authUser: { ...baseUser, id: "student-1", role: "student" },
      clinicId: "clinic-a",
      now: FIXED_NOW,
    });
    expect(snap.reason).toBe("STUDENT_NEVER_ELEVATED");
    expect(snap.source).toBe("no_active_shift");
    // Student hard-stop runs before the check-in lookup, so the mock should
    // never have been called.
    expect(getOpenClinicalCheckInMock).not.toHaveBeenCalled();
  });
});

describe("drift preservation with cache on (test #11)", () => {
  it("increments authority_drift_role on every drift observation", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue({
      id: "ck-1",
      clinicId: "clinic-a",
      userId: "user-1",
      clinicalRoleAtCheckIn: "technician",
      operationalRole: "ward",
      checkedInAt: FIXED_NOW,
    });
    resolveCurrentRoleMock.mockResolvedValue({
      effectiveRole: "senior_technician",
      permanentRole: "technician",
      source: "shift",
      activeShift: {
        id: "shift-1",
        date: "2026-05-14",
        startTime: "08:00:00",
        endTime: "20:00:00",
        employeeName: "Test User",
        role: "senior_technician",
      },
      resolvedAt: FIXED_NOW,
    });

    // First call — drift counter should increment.
    await resolveAuthority({
      authUser: baseUser,
      clinicId: "clinic-a",
      now: FIXED_NOW,
    });
    let snap = getMetricsSnapshot();
    expect(snap.authority.drift.role).toBe(1);

    // Second call — cache hit on both, but drift still observed at the
    // resolver level because the cached values produce the same drift.
    await resolveAuthority({
      authUser: baseUser,
      clinicId: "clinic-a",
      now: FIXED_NOW,
    });
    snap = getMetricsSnapshot();
    expect(snap.authority.drift.role).toBe(2);
  });
});

describe("asymmetric error containment with cache on (test #12)", () => {
  it("cached check-in + thrown shift lookup → source=check_in", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue({
      id: "ck-1",
      clinicId: "clinic-a",
      userId: "user-1",
      clinicalRoleAtCheckIn: "technician",
      operationalRole: "ward",
      checkedInAt: FIXED_NOW,
    });
    resolveCurrentRoleMock.mockRejectedValue(new Error("shift db down"));

    const first = await resolveAuthority({
      authUser: baseUser,
      clinicId: "clinic-a",
      now: FIXED_NOW,
    });
    expect(first.source).toBe("check_in");
    expect(first.reason).toMatch(/CHECKED_IN/);

    // Second call — check-in cached; shift lookup still throws but is
    // contained.
    const second = await resolveAuthority({
      authUser: baseUser,
      clinicId: "clinic-a",
      now: FIXED_NOW,
    });
    expect(second.source).toBe("check_in");

    const snap = getMetricsSnapshot();
    expect(snap.authority.drift.shiftLookupFailed).toBeGreaterThanOrEqual(2);
    // Critically, the cached check-in returned a true value, NOT undefined,
    // even though the shift lookup failed each time.
    expect(getOpenClinicalCheckInMock).toHaveBeenCalledTimes(1);
  });
});
