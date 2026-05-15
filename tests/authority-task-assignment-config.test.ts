/**
 * Phase 3 PR 3.3 — Task-assignment config resolver tests.
 *
 * Exercises the resolution chain: per-clinic override → env default → "off",
 * plus the 10s TTL cache and the test-only cache reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent side effects from importing db.ts.
vi.mock("../server/db.js", () => ({ db: {}, users: {} }));

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

import {
  __resetEnforcementConfigCacheForTests,
  resolveTaskAssignmentEnforcementMode,
} from "../server/lib/authority/enforcement/config.js";

beforeEach(() => {
  __resetEnforcementConfigCacheForTests();
  mockGetServerConfigValue.mockReset();
  delete process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1;
});

afterEach(() => {
  __resetEnforcementConfigCacheForTests();
  delete process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1;
});

describe("resolveTaskAssignmentEnforcementMode — chain resolution", () => {
  it("returns 'off' when no override and no env default", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    expect(await resolveTaskAssignmentEnforcementMode("clinic-1")).toBe("off");
  });

  it("per-clinic override beats env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1 = "shadow";
    expect(await resolveTaskAssignmentEnforcementMode("clinic-1")).toBe("enforce");
  });

  it("env default applies when no per-clinic override", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1 = "shadow";
    expect(await resolveTaskAssignmentEnforcementMode("clinic-1")).toBe("shadow");
  });

  it("invalid override values fall through to env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("BOGUS");
    process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1 = "enforce";
    expect(await resolveTaskAssignmentEnforcementMode("clinic-1")).toBe("enforce");
  });

  it("invalid env values collapse to 'off'", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1 = "BOGUS";
    expect(await resolveTaskAssignmentEnforcementMode("clinic-1")).toBe("off");
  });

  it("getServerConfigValue throw is treated as no override", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("db blip"));
    process.env.AUTHORITY_TASK_ASSIGNMENT_ENFORCE_V1 = "shadow";
    expect(await resolveTaskAssignmentEnforcementMode("clinic-1")).toBe("shadow");
  });

  it("accepts all three valid modes from per-clinic override", async () => {
    for (const mode of ["off", "shadow", "enforce"] as const) {
      __resetEnforcementConfigCacheForTests();
      mockGetServerConfigValue.mockResolvedValue(mode);
      expect(await resolveTaskAssignmentEnforcementMode(`clinic-${mode}`)).toBe(mode);
    }
  });
});

describe("resolveTaskAssignmentEnforcementMode — caching", () => {
  it("second call within TTL window does not re-query getServerConfigValue", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveTaskAssignmentEnforcementMode("clinic-c");
    await resolveTaskAssignmentEnforcementMode("clinic-c");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
  });

  it("__resetEnforcementConfigCacheForTests flushes the task-assignment cache", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveTaskAssignmentEnforcementMode("clinic-d");
    __resetEnforcementConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("shadow");
    expect(await resolveTaskAssignmentEnforcementMode("clinic-d")).toBe("shadow");
  });

  it("different clinics resolve independently", async () => {
    mockGetServerConfigValue
      .mockResolvedValueOnce("enforce")
      .mockResolvedValueOnce("shadow");
    expect(await resolveTaskAssignmentEnforcementMode("clinic-a")).toBe("enforce");
    expect(await resolveTaskAssignmentEnforcementMode("clinic-b")).toBe("shadow");
  });
});
