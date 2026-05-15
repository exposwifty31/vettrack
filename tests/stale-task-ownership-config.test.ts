/**
 * Phase 3 PR 3.6 — stale-task-ownership config resolver tests.
 *
 * Mirrors the PR 3.3 task-assignment config tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({ db: {}, users: {} }));

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

import {
  __resetEnforcementConfigCacheForTests,
  resolveStaleTaskOwnershipEnforcementMode,
} from "../server/lib/authority/enforcement/config.js";

beforeEach(() => {
  __resetEnforcementConfigCacheForTests();
  mockGetServerConfigValue.mockReset();
  delete process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1;
});

afterEach(() => {
  __resetEnforcementConfigCacheForTests();
  delete process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1;
});

describe("resolveStaleTaskOwnershipEnforcementMode — chain resolution", () => {
  it("'off' when no override and no env default", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-1")).toBe("off");
  });

  it("per-clinic override beats env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1 = "shadow";
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-1")).toBe("enforce");
  });

  it("env default applies when no per-clinic override", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1 = "shadow";
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-1")).toBe("shadow");
  });

  it("invalid env values collapse to 'off'", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1 = "BOGUS";
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-1")).toBe("off");
  });

  it("getServerConfigValue throw is treated as no override", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("db blip"));
    process.env.AUTHORITY_STALE_TASK_OWNERSHIP_ENFORCE_V1 = "shadow";
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-1")).toBe("shadow");
  });
});

describe("resolveStaleTaskOwnershipEnforcementMode — caching", () => {
  it("second call within TTL window does not re-query getServerConfigValue", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveStaleTaskOwnershipEnforcementMode("clinic-c");
    await resolveStaleTaskOwnershipEnforcementMode("clinic-c");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
  });

  it("__resetEnforcementConfigCacheForTests flushes the stale-task-ownership cache", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveStaleTaskOwnershipEnforcementMode("clinic-d");
    __resetEnforcementConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("shadow");
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-d")).toBe("shadow");
  });

  it("different clinics resolve independently", async () => {
    mockGetServerConfigValue
      .mockResolvedValueOnce("enforce")
      .mockResolvedValueOnce("shadow");
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-a")).toBe("enforce");
    expect(await resolveStaleTaskOwnershipEnforcementMode("clinic-b")).toBe("shadow");
  });
});
