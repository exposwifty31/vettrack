/**
 * Phase 2.5 PR 7 — Resolver integration smoke.
 *
 * Wires both evaluators through the real resolveAuthority path with the cache
 * wrappers mocked. Asserts:
 *   - Stale enforce + stale row → denial snapshot with CHECKED_IN_STALE.
 *   - OPROLE enforce + revoked role → denial snapshot with
 *     CHECKED_IN_OPROLE_REVOKED.
 *   - effectiveClinicalRole is null on both denial snapshots so the existing
 *     middleware deny branch handles them with zero edits.
 *   - PR 5.3 shadow scheduler still fires once per check-in resolution,
 *     independently of PR 7 evaluator outcome.
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
import { recordSuccess } from "../server/lib/circuit-breaker.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function setCheckIn(hoursAgo: number, operationalRole: string | null): void {
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

function setShift(role: string): void {
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
  recordSuccess("authority-oprole-cache");
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

describe("resolver integration smoke — stale enforce", () => {
  it("denies with CHECKED_IN_STALE and effectiveClinicalRole=null", async () => {
    setCheckIn(48, "admission");
    setShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();

    const snap = await run();

    expect(snap.reason).toBe("CHECKED_IN_STALE");
    expect(snap.effectiveClinicalRole).toBeNull();
    expect(snap.source).toBe("check_in");
    expect(snap.operationalRole).toBeNull();
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(1);
  });

  it("PR 5.3 shadow scheduler still fires before the stale denial", async () => {
    setCheckIn(48, "admission");
    setShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();

    await run();

    expect(scheduleShadowMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolver integration smoke — OPROLE enforce", () => {
  it("denies with CHECKED_IN_OPROLE_REVOKED when role not in allowlist", async () => {
    setCheckIn(1, "admission");
    setShift("vet");
    allowlistFetcherMock.mockResolvedValue({ kind: "ok", allowlist: ["ward"] });
    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();

    const snap = await run();

    expect(snap.reason).toBe("CHECKED_IN_OPROLE_REVOKED");
    expect(snap.effectiveClinicalRole).toBeNull();
    expect(snap.operationalRole).toBeNull();
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(1);
  });

  it("allows when role IS in allowlist", async () => {
    setCheckIn(1, "admission");
    setShift("vet");
    allowlistFetcherMock.mockResolvedValue({
      kind: "ok",
      allowlist: ["admission", "ward"],
    });
    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();

    const snap = await run();

    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
    expect(snap.operationalRole).toBe("admission");
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(0);
  });
});

describe("resolver integration smoke — both enforce, precedence preserved", () => {
  it("stale + revoked → CHECKED_IN_STALE (stale wins)", async () => {
    setCheckIn(48, "admission");
    setShift("vet");
    allowlistFetcherMock.mockResolvedValue({ kind: "ok", allowlist: [] });
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "enforce";
    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();

    const snap = await run();

    expect(snap.reason).toBe("CHECKED_IN_STALE");
    // Single-denial invariant: only stale counter moved.
    const auth = getMetricsSnapshot().authority;
    expect(auth.staleEnforce.denied).toBe(1);
    expect(auth.oproleEnforce.denied).toBe(0);
  });
});
