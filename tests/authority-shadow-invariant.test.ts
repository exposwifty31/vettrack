/**
 * Phase 2.5 PR 7 — Shadow invariant (stale-only).
 *
 * OPROLE has NO shadow mode in PR 7 — shadow telemetry is owned by PR 5.3.
 * This suite asserts only the stale shadow surface.
 *
 * Under AUTHORITY_STALE_ENFORCE_V1=shadow:
 *   - the snapshot is byte-equal to what off-mode would produce,
 *   - authority_stale_would_have_denied increments on a stale row,
 *   - authority_stale_denied stays at 0,
 *   - PR 5.3 counters are not touched by PR 7 flag state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveShiftSnapshot,
  RoleResolutionResult,
} from "../server/lib/role-resolution.js";
import type { OpenClinicalCheckInRow } from "../server/lib/check-in-resolution.js";

const resolveCurrentRoleCachedMock = vi.fn<
  (input: unknown) => Promise<RoleResolutionResult>
>();
const getOpenClinicalCheckInCachedMock = vi.fn<
  (input: unknown) => Promise<OpenClinicalCheckInRow | null>
>();
const allowlistFetcherMock = vi.fn();

vi.mock("../server/lib/authority-cache.js", () => ({
  resolveCurrentRoleCached: (input: unknown) => resolveCurrentRoleCachedMock(input),
  getOpenClinicalCheckInCached: (input: unknown) =>
    getOpenClinicalCheckInCachedMock(input),
  getAllowedOperationalRolesCached: (input: unknown) => allowlistFetcherMock(input),
}));

vi.mock("../server/db.js", () => ({
  db: {},
  shifts: {},
  users: {},
  clinicalCheckIns: {},
  auditLogs: {},
  eventOutbox: {},
}));

const scheduleShadowMock = vi.fn();
vi.mock("../server/lib/operational-role-shadow.js", () => ({
  scheduleOperationalRoleShadowValidation: (...args: unknown[]) =>
    scheduleShadowMock(...args),
}));

import { resolveAuthority } from "../server/lib/authority.js";
import { __resetEnforcementConfigCacheForTests } from "../server/lib/authority/enforcement/config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function mockStaleCheckIn(hoursAgo: number): void {
  getOpenClinicalCheckInCachedMock.mockResolvedValue({
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-1",
    clinicalRoleAtCheckIn: "vet",
    operationalRole: "admission",
    checkedInAt: new Date(FIXED_NOW.getTime() - hoursAgo * 3600 * 1000),
    checkedOutAt: null,
  } as unknown as OpenClinicalCheckInRow);
}

function mockShift(role: string): void {
  const activeShift: ActiveShiftSnapshot = {
    id: "s-1",
    date: "2026-05-14",
    startTime: "08:00:00",
    endTime: "18:00:00",
    employeeName: "Test User",
    role: role as ActiveShiftSnapshot["role"],
  };
  resolveCurrentRoleCachedMock.mockResolvedValue({
    effectiveRole: role as RoleResolutionResult["effectiveRole"],
    permanentRole: "technician",
    source: "shift",
    activeShift,
    resolvedAt: FIXED_NOW,
  });
}

beforeEach(() => {
  resetMetrics();
  __resetEnforcementConfigCacheForTests();
  resolveCurrentRoleCachedMock.mockReset();
  getOpenClinicalCheckInCachedMock.mockReset();
  allowlistFetcherMock.mockReset();
  scheduleShadowMock.mockReset();
  process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
});

afterEach(() => {
  delete process.env.AUTHORITY_USE_CHECKIN_PATH;
  delete process.env.AUTHORITY_STALE_ENFORCE_V1;
  delete process.env.AUTHORITY_OPROLE_ENFORCE_V1;
});

async function run() {
  return resolveAuthority({
    authUser: { id: "user-1", name: "Test User", role: "vet" },
    clinicId: "clinic-1",
    now: FIXED_NOW,
  });
}

describe("stale shadow invariant", () => {
  it("shadow + stale row → snapshot identical to off, counter increments", async () => {
    mockStaleCheckIn(48);
    mockShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();

    const snap = await run();

    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
    expect(snap.source).toBe("check_in");

    const s = getMetricsSnapshot().authority.staleEnforce;
    expect(s.wouldHaveDenied).toBe(1);
    expect(s.denied).toBe(0);
  });

  it("PR 7 shadow does not interfere with PR 5.3 shadow scheduler call", async () => {
    mockStaleCheckIn(48);
    mockShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();

    await run();

    // PR 5.3 shadow scheduler is still invoked once per check-in resolution,
    // regardless of PR 7 stale shadow state. PR 7 and PR 5.3 are independent.
    expect(scheduleShadowMock).toHaveBeenCalledTimes(1);
  });

  it("shadow + fresh row → no counter movement", async () => {
    mockStaleCheckIn(1);
    mockShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();

    await run();

    const s = getMetricsSnapshot().authority.staleEnforce;
    expect(s.wouldHaveDenied).toBe(0);
    expect(s.denied).toBe(0);
  });
});
