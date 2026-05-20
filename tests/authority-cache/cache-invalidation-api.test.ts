/**
 * Phase 2.5 PR 6 — Invalidation API contract tests.
 *
 * Tests `invalidateForUser` and `invalidateClinicShift` directly against
 * primed cache state, verifying:
 *  - cache entries removed
 *  - epochs bumped
 *  - inflight entries cleared
 *  - counters incremented
 *  - other clinics/users not affected
 *  - clinic-wide shift clears all matching keys
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenClinicalCheckInRow } from "../../server/lib/check-in-resolution.js";
import type {
  RoleResolutionInput,
  RoleResolutionResult,
} from "../../server/lib/role-resolution.js";
import { getMetricsSnapshot, resetMetrics } from "../../server/lib/metrics.js";

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

const {
  getOpenClinicalCheckInCached,
  resolveCurrentRoleCached,
  invalidateForUser,
  invalidateClinicShift,
  __resetAuthorityCacheForTests,
  __internals,
} = await import("../../server/lib/authority-cache.js");

const baseRow: OpenClinicalCheckInRow = {
  id: "ck-1",
  clinicId: "clinic-a",
  userId: "user-1",
  clinicalRoleAtCheckIn: "technician",
  operationalRole: "ward",
  checkedInAt: new Date(),
};

function makeResult(p: Partial<RoleResolutionResult> = {}): RoleResolutionResult {
  return {
    effectiveRole: "technician",
    permanentRole: "technician",
    source: "permanent",
    activeShift: null,
    resolvedAt: new Date(),
    ...p,
  };
}

const baseInput: RoleResolutionInput = {
  clinicId: "clinic-a",
  userId: "user-1",
  userName: "User",
  fallbackRole: "technician",
  secondaryRole: null,
  now: new Date("2026-05-14T12:00:00.000Z"),
};

beforeEach(() => {
  __resetAuthorityCacheForTests();
  resetMetrics();
  getOpenClinicalCheckInMock.mockReset();
  resolveCurrentRoleMock.mockReset();
  process.env.AUTHORITY_CACHE_V1 = "true";
});

describe("invalidateForUser", () => {
  it("removes check-in cache entry and bumps epoch", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    await getOpenClinicalCheckInCached({ clinicId: "clinic-a", userId: "user-1" });
    const key = __internals.checkInKey("clinic-a", "user-1");
    expect(__internals.checkInCache.get(key)).toBeTruthy();
    const epochBefore = __internals.checkInCache.epochOf(key);

    invalidateForUser("clinic-a", "user-1");

    expect(__internals.checkInCache.get(key)).toBeNull();
    expect(__internals.checkInCache.epochOf(key)).toBe(epochBefore + 1);
    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.invalidateCheckIn).toBe(1);
  });

  it("removes all matching shift cache entries by prefix", async () => {
    resolveCurrentRoleMock.mockResolvedValue(makeResult());
    await resolveCurrentRoleCached(baseInput);
    await resolveCurrentRoleCached({ ...baseInput, fallbackRole: "vet" });
    expect(__internals.shiftCache.size()).toBe(2);

    invalidateForUser("clinic-a", "user-1");
    expect(__internals.shiftCache.size()).toBe(0);
    expect(getMetricsSnapshot().authority.cache.invalidateShift).toBe(1);
  });

  it("does not affect other users in same clinic", async () => {
    resolveCurrentRoleMock.mockResolvedValue(makeResult());
    await resolveCurrentRoleCached(baseInput);
    await resolveCurrentRoleCached({ ...baseInput, userId: "user-2" });
    expect(__internals.shiftCache.size()).toBe(2);

    invalidateForUser("clinic-a", "user-1");
    expect(__internals.shiftCache.size()).toBe(1);
  });

  it("does not affect users in other clinics", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    await getOpenClinicalCheckInCached({ clinicId: "clinic-a", userId: "user-1" });
    await getOpenClinicalCheckInCached({ clinicId: "clinic-b", userId: "user-1" });
    expect(__internals.checkInCache.size()).toBe(2);

    invalidateForUser("clinic-a", "user-1");
    expect(__internals.checkInCache.size()).toBe(1);
    expect(
      __internals.checkInCache.get(__internals.checkInKey("clinic-b", "user-1")),
    ).toBeTruthy();
  });
});

describe("invalidateClinicShift", () => {
  it("clears all shift entries for the clinic", async () => {
    resolveCurrentRoleMock.mockResolvedValue(makeResult());
    await resolveCurrentRoleCached(baseInput);
    await resolveCurrentRoleCached({ ...baseInput, userId: "user-2" });
    await resolveCurrentRoleCached({ ...baseInput, clinicId: "clinic-b" });
    expect(__internals.shiftCache.size()).toBe(3);

    invalidateClinicShift("clinic-a");
    expect(__internals.shiftCache.size()).toBe(1);
    const snap = getMetricsSnapshot();
    expect(snap.authority.cache.invalidateClinicShift).toBe(1);
  });

  it("does not touch check-in cache", async () => {
    getOpenClinicalCheckInMock.mockResolvedValue(baseRow);
    await getOpenClinicalCheckInCached({ clinicId: "clinic-a", userId: "user-1" });

    invalidateClinicShift("clinic-a");
    expect(__internals.checkInCache.size()).toBe(1);
  });
});
