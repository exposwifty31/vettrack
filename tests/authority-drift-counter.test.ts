/**
 * Phase 2.5 PR 5: Asserts that drift events in server/lib/authority.ts
 * increment the always-on counters in metrics.ts, independent of the log
 * limiter's sampling decision. The console.warn line is allowed to be
 * suppressed; the counter increment must not be.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleResolutionResult } from "../server/lib/role-resolution.js";
import type { OpenClinicalCheckInRow } from "../server/lib/check-in-resolution.js";

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
vi.mock("../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
  clinicalCheckIns: {},
}));

import { resolveAuthority } from "../server/lib/authority.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

const FIXED_NOW = new Date("2026-05-13T12:00:00.000Z");
const originalFlag = process.env.AUTHORITY_USE_CHECKIN_PATH;
let warnSpy: ReturnType<typeof vi.spyOn>;

function makeCheckIn(role = "technician"): OpenClinicalCheckInRow {
  return {
    id: "ci-1",
    clinicId: "c1",
    userId: "user-1",
    clinicalRoleAtCheckIn: role,
    operationalRole: "ward",
    checkedInAt: new Date("2026-05-13T08:00:00.000Z"),
  };
}

beforeEach(() => {
  resolveCurrentRoleMock.mockReset();
  getOpenClinicalCheckInMock.mockReset();
  resetMetrics();
  process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  if (originalFlag === undefined) {
    delete process.env.AUTHORITY_USE_CHECKIN_PATH;
  } else {
    process.env.AUTHORITY_USE_CHECKIN_PATH = originalFlag;
  }
});

describe("authority drift counters", () => {
  it("authority_drift_role increments when shift role disagrees with check-in role", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(makeCheckIn("technician"));
    resolveCurrentRoleMock.mockResolvedValue({
      effectiveRole: "vet",
      permanentRole: "technician",
      source: "shift",
      activeShift: {
        id: "shift-1",
        date: "2026-05-13",
        startTime: "08:00:00",
        endTime: "18:00:00",
        employeeName: "Test User",
        role: "vet",
      },
      resolvedAt: FIXED_NOW,
    });

    await resolveAuthority({
      authUser: {
        id: "user-1",
        name: "Test User",
        role: "technician",
        secondaryRole: null,
      },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    const snap = getMetricsSnapshot();
    expect(snap.authority.drift.role).toBe(1);
    expect(snap.authority.drift.shiftLookupFailed).toBe(0);
  });

  it("authority_drift_shift_lookup_failed increments when shift lookup throws after a successful check-in", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(makeCheckIn("technician"));
    resolveCurrentRoleMock.mockRejectedValue(new Error("db down"));

    await resolveAuthority({
      authUser: {
        id: "user-1",
        name: "Test User",
        role: "technician",
        secondaryRole: null,
      },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    const snap = getMetricsSnapshot();
    expect(snap.authority.drift.shiftLookupFailed).toBe(1);
    expect(snap.authority.drift.role).toBe(0);
  });

  it("no drift counter increment when shift role agrees with check-in role", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(makeCheckIn("technician"));
    resolveCurrentRoleMock.mockResolvedValue({
      effectiveRole: "technician",
      permanentRole: "technician",
      source: "shift",
      activeShift: {
        id: "shift-1",
        date: "2026-05-13",
        startTime: "08:00:00",
        endTime: "18:00:00",
        employeeName: "Test User",
        role: "technician",
      },
      resolvedAt: FIXED_NOW,
    });

    await resolveAuthority({
      authUser: {
        id: "user-1",
        name: "Test User",
        role: "technician",
        secondaryRole: null,
      },
      clinicId: "c1",
      now: FIXED_NOW,
    });

    const snap = getMetricsSnapshot();
    expect(snap.authority.drift.role).toBe(0);
    expect(snap.authority.drift.shiftLookupFailed).toBe(0);
  });
});
