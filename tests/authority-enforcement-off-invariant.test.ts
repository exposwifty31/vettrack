/**
 * Phase 2.5 PR 7 — Off invariant.
 *
 * With BOTH enforcement flags off, the resolver's behavior must be
 * identical to the pre-PR-7 baseline for every check-in-backed snapshot
 * and every Strategy A path. PR 7 counters must NOT move.
 *
 * Tested via the resolveAuthority entry point with both cache wrappers
 * mocked. No DB.
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

// PR 5.3 shadow scheduler must remain a no-op in this suite (we never set the
// flag) — but its module loads. Stub to keep counter assertions clean.
vi.mock("../server/lib/operational-role-shadow.js", () => ({
  scheduleOperationalRoleShadowValidation: vi.fn(),
}));

import { resolveAuthority } from "../server/lib/authority.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import { __resetEnforcementConfigCacheForTests } from "../server/lib/authority/enforcement/config.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function mockNoCheckIn(): void {
  getOpenClinicalCheckInCachedMock.mockResolvedValue(null);
}

function mockCheckIn(operationalRole: string | null, hoursAgo: number): void {
  getOpenClinicalCheckInCachedMock.mockResolvedValue({
    id: "ci-1",
    clinicId: "clinic-1",
    userId: "user-1",
    clinicalRoleAtCheckIn: "vet",
    operationalRole,
    checkedInAt: new Date(FIXED_NOW.getTime() - hoursAgo * 3600 * 1000),
    checkedOutAt: null,
  } as unknown as OpenClinicalCheckInRow);
}

function mockShift(role: string | null): void {
  const activeShift: ActiveShiftSnapshot | null = role
    ? {
        id: "s-1",
        date: "2026-05-14",
        startTime: "08:00:00",
        endTime: "18:00:00",
        employeeName: "Test User",
        role: role as ActiveShiftSnapshot["role"],
      }
    : null;
  resolveCurrentRoleCachedMock.mockResolvedValue({
    effectiveRole: (role ?? "technician") as RoleResolutionResult["effectiveRole"],
    permanentRole: "technician",
    source: activeShift ? "shift" : "permanent",
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
  process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
  delete process.env.AUTHORITY_STALE_ENFORCE_V1;
  delete process.env.AUTHORITY_OPROLE_ENFORCE_V1;
});

afterEach(() => {
  delete process.env.AUTHORITY_USE_CHECKIN_PATH;
  delete process.env.AUTHORITY_STALE_ENFORCE_V1;
  delete process.env.AUTHORITY_OPROLE_ENFORCE_V1;
});

describe("off invariant — PR 7 flags both off", () => {
  it("CHECKED_IN row 48h old + role revoked → still allowed (snapshot reason CHECKED_IN)", async () => {
    mockCheckIn("admission", 48);
    mockShift("vet");
    allowlistFetcherMock.mockResolvedValue({ kind: "ok", allowlist: [] });

    const snap = await resolveAuthority({
      authUser: { id: "user-1", name: "Test User", role: "vet" },
      clinicId: "clinic-1",
      now: FIXED_NOW,
    });

    expect(snap.source).toBe("check_in");
    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
  });

  it("CHECKED_IN_NO_OPROLE row stays CHECKED_IN_NO_OPROLE", async () => {
    mockCheckIn(null, 48);
    mockShift("vet");

    const snap = await resolveAuthority({
      authUser: { id: "user-1", name: "Test User", role: "vet" },
      clinicId: "clinic-1",
      now: FIXED_NOW,
    });

    expect(snap.reason).toBe("CHECKED_IN_NO_OPROLE");
    expect(snap.effectiveClinicalRole).toBe("vet");
  });

  it("no PR 7 counters move under off + check-in path", async () => {
    mockCheckIn("admission", 48);
    mockShift("vet");
    allowlistFetcherMock.mockResolvedValue({ kind: "ok", allowlist: [] });

    await resolveAuthority({
      authUser: { id: "user-1", name: "Test User", role: "vet" },
      clinicId: "clinic-1",
      now: FIXED_NOW,
    });

    const auth = getMetricsSnapshot().authority;
    expect(auth.staleEnforce.wouldHaveDenied).toBe(0);
    expect(auth.staleEnforce.denied).toBe(0);
    expect(auth.staleEnforce.skippedLegacyPath).toBe(0);
    expect(auth.oproleEnforce.denied).toBe(0);
  });

  it("OPROLE allowlist fetcher is NOT called under off mode (no DB amplification)", async () => {
    mockCheckIn("admission", 1);
    mockShift("vet");

    await resolveAuthority({
      authUser: { id: "user-1", name: "Test User", role: "vet" },
      clinicId: "clinic-1",
      now: FIXED_NOW,
    });

    expect(allowlistFetcherMock).not.toHaveBeenCalled();
  });

  it("legacy Strategy A path (EZSHIFT_ACTIVE) unaffected", async () => {
    mockNoCheckIn();
    mockShift("technician");

    const snap = await resolveAuthority({
      authUser: { id: "user-1", name: "Test User", role: "technician" },
      clinicId: "clinic-1",
      now: FIXED_NOW,
    });

    expect(snap.source).toBe("shift");
    expect(snap.reason).toBe("EZSHIFT_ACTIVE");
    expect(snap.effectiveClinicalRole).toBe("technician");
  });
});
