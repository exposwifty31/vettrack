/**
 * Phase 2.5 PR 7 — Rollback invariant.
 *
 * Asserts §4.5: flipping either flag from {shadow|enforce} to "off" must
 * stop new counters for that family and restore byte-identical snapshots
 * within one config TTL window — without process restart, without cache flush.
 *
 * The 10s in-process TTL on per-clinic config reads is bypassed in tests via
 * __resetEnforcementConfigCacheForTests so test runs are deterministic.
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
import {
  __resetEnforcementConfigCacheForTests,
} from "../server/lib/authority/enforcement/config.js";
import { getMetricsSnapshot, resetMetrics } from "../server/lib/metrics.js";
import { recordSuccess } from "../server/lib/circuit-breaker.js";

const FIXED_NOW = new Date("2026-05-14T12:00:00.000Z");

function setStaleCheckIn(hoursAgo: number, operationalRole: string | null): void {
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
  process.env.AUTHORITY_USE_CHECKIN_PATH = "true";
});

afterEach(() => {
  delete process.env.AUTHORITY_USE_CHECKIN_PATH;
  delete process.env.AUTHORITY_STALE_ENFORCE_V1;
  delete process.env.AUTHORITY_OPROLE_ENFORCE_V1;
  recordSuccess("authority-oprole-cache");
});

async function run() {
  return resolveAuthority({
    authUser: { id: "user-1", name: "Test User", role: "vet" },
    clinicId: "clinic-1",
    now: FIXED_NOW,
  });
}

describe("rollback invariant — stale: shadow → off", () => {
  it("stops counter movement and restores off-mode snapshot byte-equal", async () => {
    setStaleCheckIn(48, "admission");
    setShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "shadow";
    __resetEnforcementConfigCacheForTests();
    await run();
    expect(getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied).toBe(1);

    // Flip to off — simulates a vt_server_config flip after TTL expiry.
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "off";
    __resetEnforcementConfigCacheForTests();
    const before = getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied;
    const snap = await run();
    const after = getMetricsSnapshot().authority.staleEnforce.wouldHaveDenied;

    expect(after).toBe(before);
    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
  });
});

describe("rollback invariant — stale: enforce → off", () => {
  it("stops counter movement and restores off-mode snapshot byte-equal", async () => {
    setStaleCheckIn(48, "admission");
    setShift("vet");
    process.env.AUTHORITY_STALE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const denySnap = await run();
    expect(denySnap.reason).toBe("CHECKED_IN_STALE");
    expect(getMetricsSnapshot().authority.staleEnforce.denied).toBe(1);

    process.env.AUTHORITY_STALE_ENFORCE_V1 = "off";
    __resetEnforcementConfigCacheForTests();
    const before = getMetricsSnapshot().authority.staleEnforce.denied;
    const snap = await run();
    const after = getMetricsSnapshot().authority.staleEnforce.denied;

    expect(after).toBe(before);
    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
  });
});

describe("rollback invariant — OPROLE: enforce → off", () => {
  it("stops denial and restores allow within one TTL window", async () => {
    setStaleCheckIn(1, "admission"); // fresh
    setShift("vet");
    allowlistFetcherMock.mockResolvedValue({ kind: "ok", allowlist: [] });

    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const denySnap = await run();
    expect(denySnap.reason).toBe("CHECKED_IN_OPROLE_REVOKED");
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(1);

    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "off";
    __resetEnforcementConfigCacheForTests();
    const before = getMetricsSnapshot().authority.oproleEnforce.denied;
    const snap = await run();
    const after = getMetricsSnapshot().authority.oproleEnforce.denied;

    expect(after).toBe(before);
    expect(snap.reason).toBe("CHECKED_IN");
    expect(snap.effectiveClinicalRole).toBe("vet");
  });
});

describe("rollback invariant — independence of families", () => {
  it("flipping stale off leaves OPROLE enforcement intact", async () => {
    setStaleCheckIn(48, "admission"); // both stale AND revoked
    setShift("vet");
    allowlistFetcherMock.mockResolvedValue({ kind: "ok", allowlist: [] });

    process.env.AUTHORITY_STALE_ENFORCE_V1 = "enforce";
    process.env.AUTHORITY_OPROLE_ENFORCE_V1 = "enforce";
    __resetEnforcementConfigCacheForTests();
    const first = await run();
    expect(first.reason).toBe("CHECKED_IN_STALE");

    process.env.AUTHORITY_STALE_ENFORCE_V1 = "off";
    __resetEnforcementConfigCacheForTests();
    const second = await run();
    expect(second.reason).toBe("CHECKED_IN_OPROLE_REVOKED");
    expect(getMetricsSnapshot().authority.oproleEnforce.denied).toBe(1);
  });
});
