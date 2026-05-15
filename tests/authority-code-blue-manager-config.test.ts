/**
 * Phase 4 PR 4.1 — Code Blue manager enforcement-mode config resolver tests.
 *
 * Exercises the resolution chain (per-clinic vt_server_config override → env
 * default → "off"), the per-endpoint sub-key independence, the 10s TTL cache,
 * and the test-only cache reset.
 *
 * Mirrors `authority-task-assignment-config.test.ts`. Mocks `server/db.js`
 * and `server/lib/server-config.js` to keep this a unit test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent side effects from importing db.ts (the config module pulls in
// server-config which pulls in db).
vi.mock("../server/db.js", () => ({ db: {}, users: {} }));

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

import {
  __resetEnforcementConfigCacheForTests,
  resolveCodeBlueManagerEnforcementMode,
} from "../server/lib/authority/enforcement/config.js";

beforeEach(() => {
  __resetEnforcementConfigCacheForTests();
  mockGetServerConfigValue.mockReset();
  delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
});

afterEach(() => {
  __resetEnforcementConfigCacheForTests();
  delete process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1;
});

describe("resolveCodeBlueManagerEnforcementMode — chain resolution", () => {
  it("returns 'off' when no override and no env default", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "initiation"),
    ).toBe("off");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "end"),
    ).toBe("off");
  });

  it("per-clinic override beats env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "initiation"),
    ).toBe("enforce");
  });

  it("env default applies when no per-clinic override", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "end"),
    ).toBe("shadow");
  });

  it("invalid override values fall through to env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("BOGUS");
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "enforce";
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "initiation"),
    ).toBe("enforce");
  });

  it("invalid env values collapse to 'off'", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "BOGUS";
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "end"),
    ).toBe("off");
  });

  it("getServerConfigValue throw is treated as no override", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("db blip"));
    process.env.AUTHORITY_CODE_BLUE_MANAGER_ENFORCE_V1 = "shadow";
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-1", "initiation"),
    ).toBe("shadow");
  });

  it("accepts all three valid modes from per-clinic override", async () => {
    for (const mode of ["off", "shadow", "enforce"] as const) {
      __resetEnforcementConfigCacheForTests();
      mockGetServerConfigValue.mockResolvedValue(mode);
      expect(
        await resolveCodeBlueManagerEnforcementMode(`clinic-${mode}`, "end"),
      ).toBe(mode);
    }
  });

  it("uses the per-endpoint sub-key in the vt_server_config lookup path", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    await resolveCodeBlueManagerEnforcementMode("clinic-x", "initiation");
    await resolveCodeBlueManagerEnforcementMode("clinic-x", "end");
    const calls = mockGetServerConfigValue.mock.calls.map((c) => c[1]);
    expect(calls).toContain("code_blue.manager_enforce.clinic-x.initiation");
    expect(calls).toContain("code_blue.manager_enforce.clinic-x.end");
  });
});

describe("resolveCodeBlueManagerEnforcementMode — endpoint independence", () => {
  it("initiation and end resolve independently within the same clinic", async () => {
    // First call returns "enforce" for initiation, second returns "shadow" for end.
    mockGetServerConfigValue
      .mockImplementationOnce(async () => "enforce")
      .mockImplementationOnce(async () => "shadow");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-a", "initiation"),
    ).toBe("enforce");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-a", "end"),
    ).toBe("shadow");
  });

  it("cached initiation does NOT leak into end (independent cache keys)", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveCodeBlueManagerEnforcementMode("clinic-b", "initiation");
    // Second call for the SAME endpoint must hit cache.
    await resolveCodeBlueManagerEnforcementMode("clinic-b", "initiation");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
    // First call for the OTHER endpoint must miss cache.
    await resolveCodeBlueManagerEnforcementMode("clinic-b", "end");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(2);
  });
});

describe("resolveCodeBlueManagerEnforcementMode — caching", () => {
  it("second call within TTL window does not re-query getServerConfigValue", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveCodeBlueManagerEnforcementMode("clinic-c", "initiation");
    await resolveCodeBlueManagerEnforcementMode("clinic-c", "initiation");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
  });

  it("__resetEnforcementConfigCacheForTests flushes the code-blue-manager cache", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveCodeBlueManagerEnforcementMode("clinic-d", "end");
    __resetEnforcementConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("shadow");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-d", "end"),
    ).toBe("shadow");
  });

  it("different clinics resolve independently", async () => {
    mockGetServerConfigValue
      .mockResolvedValueOnce("enforce")
      .mockResolvedValueOnce("shadow");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-a", "initiation"),
    ).toBe("enforce");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-b", "initiation"),
    ).toBe("shadow");
  });
});

describe("resolveCodeBlueManagerEnforcementMode — env-default conservatism (master plan §11)", () => {
  it("env default is NOT 'enforce' by accident — no per-clinic config means non-enforce", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    // No env var set in beforeEach.
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-q", "initiation"),
    ).not.toBe("enforce");
    expect(
      await resolveCodeBlueManagerEnforcementMode("clinic-q", "end"),
    ).not.toBe("enforce");
  });
});
