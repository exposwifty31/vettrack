/**
 * Phase 2.5 PR 7 — Strategy A invariant.
 *
 * With NO check-in row, the resolver must produce a byte-identical snapshot
 * regardless of PR 7 flag state (off / shadow / enforce, both flags). Stale
 * and OPROLE evaluators must never run on Strategy A inputs.
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

vi.mock("../server/lib/operational-role-shadow.js", () => ({
  scheduleOperationalRoleShadowValidation: vi.fn(),
}));

import { resolveAuthority } from "../server/lib/authority.js";
import { __resetEnforcementConfigCacheForTests } from "../server/lib/authority/enforcement/config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

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
  // No check-in row — Strategy A path.
  getOpenClinicalCheckInCachedMock.mockResolvedValue(null);
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

describe("Strategy A invariant — no check-in row", () => {
  const flagPairs: Array<[string, string]> = [
    ["off", "off"],
    ["shadow", "off"],
    ["enforce", "off"],
    ["off", "enforce"],
    ["shadow", "enforce"],
    ["enforce", "enforce"],
  ];

  for (const [stale, oprole] of flagPairs) {
    it(`snapshot byte-equal across PR 7 flag state (stale=${stale}, oprole=${oprole})`, async () => {
      mockShift("vet");
      process.env.AUTHORITY_STALE_ENFORCE_V1 = stale;
      process.env.AUTHORITY_OPROLE_ENFORCE_V1 = oprole;
      __resetEnforcementConfigCacheForTests();

      const snap = await run();

      expect(snap.source).toBe("shift");
      expect(snap.reason).toBe("EZSHIFT_ACTIVE");
      expect(snap.effectiveClinicalRole).toBe("vet");
    });
  }

  it("PR 7 counters never move on Strategy A inputs (tombstone)", async () => {
    mockShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "enforce";
    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    await run();
    const auth = getMetricsSnapshot().authority;
    expect(auth.staleEnforce.wouldHaveDenied).toBe(0);
    expect(auth.staleEnforce.denied).toBe(0);
    expect(auth.staleEnforce.skippedLegacyPath).toBe(0);
    expect(auth.oproleEnforce.denied).toBe(0);
  });

  it("OPROLE allowlist fetcher never called on Strategy A", async () => {
    mockShift("vet");
    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    await run();
    expect(allowlistFetcherMock).not.toHaveBeenCalled();
  });
});
