/**
 * Phase 5 PR 5.1 — Clinical-invariant config resolver tests.
 *
 * Mirrors `tests/stale-task-ownership-config.test.ts` (the PR 3.6
 * template the Phase 5 plan §15 PR 5.1 calls out by name). Verifies:
 *
 *   - Resolution chain: per-clinic vt_server_config override → env
 *     default `COP_CLINICAL_INVARIANT_ENFORCE_V1` → `"off"`.
 *   - Per-clinic key: `cop.clinical_invariant_enforce.<clinicId>`.
 *   - Typo-defensive: invalid values collapse to `"off"`.
 *   - Strategy A: `getServerConfigValue` throw is silently treated as
 *     "no override" — the env default and ultimate "off" fall-through
 *     apply.
 *   - 10s TTL cache: a second call within the window does not re-query
 *     `getServerConfigValue`.
 *   - Independent clinic resolution: clinic A and clinic B resolve
 *     independently.
 *   - Test-only escape hatch flushes the cache.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({ db: {}, users: {} }));

const mockGetServerConfigValue = vi.fn();
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

import {
  __resetClinicalInvariantConfigCacheForTests,
  __testInternals,
  resolveClinicalInvariantEnforcementMode,
} from "../server/lib/authority/enforcement/clinical-invariant.config.js";

beforeEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  mockGetServerConfigValue.mockReset();
  delete process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
});

afterEach(() => {
  __resetClinicalInvariantConfigCacheForTests();
  delete process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1;
});

describe("resolveClinicalInvariantEnforcementMode — chain resolution", () => {
  it("'off' when no override and no env default", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("off");
  });

  it("per-clinic override beats env default", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "shadow";
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("enforce");
  });

  it("env default applies when no per-clinic override", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "shadow";
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("shadow");
  });

  it("each of off / shadow / enforce round-trips through the per-clinic override", async () => {
    for (const mode of ["off", "shadow", "enforce"] as const) {
      __resetClinicalInvariantConfigCacheForTests();
      mockGetServerConfigValue.mockResolvedValue(mode);
      expect(await resolveClinicalInvariantEnforcementMode("clinic-x")).toBe(mode);
    }
  });

  it("typo-defensive: invalid env values collapse to 'off'", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "BOGUS";
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("off");
  });

  it("typo-defensive: invalid per-clinic override falls through to env default then 'off'", async () => {
    mockGetServerConfigValue.mockResolvedValue("ENFORCED"); // wrong case
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("off");

    __resetClinicalInvariantConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("ENFORCED");
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "shadow";
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("shadow");
  });

  it("Strategy A: getServerConfigValue throw is treated as no override", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("db blip"));
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "shadow";
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("shadow");
  });

  it("Strategy A: getServerConfigValue throw plus no env default collapses to 'off'", async () => {
    mockGetServerConfigValue.mockRejectedValue(new Error("db blip"));
    expect(await resolveClinicalInvariantEnforcementMode("clinic-1")).toBe("off");
  });

  it("per-clinic key embeds the clinicId in `cop.clinical_invariant_enforce.<clinicId>`", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    await resolveClinicalInvariantEnforcementMode("clinic-zeta");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
    expect(mockGetServerConfigValue).toHaveBeenCalledWith(
      "clinic-zeta",
      "cop.clinical_invariant_enforce.clinic-zeta",
    );
  });
});

describe("resolveClinicalInvariantEnforcementMode — caching", () => {
  it("second call within TTL window does not re-query getServerConfigValue", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveClinicalInvariantEnforcementMode("clinic-c");
    await resolveClinicalInvariantEnforcementMode("clinic-c");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
  });

  it("__resetClinicalInvariantConfigCacheForTests flushes the clinical-invariant cache", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await resolveClinicalInvariantEnforcementMode("clinic-d");
    __resetClinicalInvariantConfigCacheForTests();
    mockGetServerConfigValue.mockResolvedValue("shadow");
    expect(await resolveClinicalInvariantEnforcementMode("clinic-d")).toBe("shadow");
  });

  it("different clinics resolve independently", async () => {
    mockGetServerConfigValue
      .mockResolvedValueOnce("enforce")
      .mockResolvedValueOnce("shadow");
    expect(await resolveClinicalInvariantEnforcementMode("clinic-a")).toBe("enforce");
    expect(await resolveClinicalInvariantEnforcementMode("clinic-b")).toBe("shadow");
  });

  it("TTL constant is 10s — matches the Phase 5 plan §19.4 rollback window", () => {
    expect(__testInternals.PER_CLINIC_TTL_MS).toBe(10_000);
  });

  it("cache hit returns the cached mode even when getServerConfigValue would now throw", async () => {
    mockGetServerConfigValue.mockResolvedValueOnce("shadow");
    expect(await resolveClinicalInvariantEnforcementMode("clinic-e")).toBe("shadow");
    mockGetServerConfigValue.mockRejectedValue(new Error("transient db blip"));
    expect(await resolveClinicalInvariantEnforcementMode("clinic-e")).toBe("shadow");
    expect(mockGetServerConfigValue).toHaveBeenCalledTimes(1);
  });
});

describe("resolveClinicalInvariantEnforcementMode — namespace isolation", () => {
  it("uses the `cop.` namespace, not the `authority.` namespace", async () => {
    mockGetServerConfigValue.mockResolvedValue(null);
    await resolveClinicalInvariantEnforcementMode("clinic-ns");
    const [, key] = mockGetServerConfigValue.mock.calls[0]!;
    expect(key as string).toMatch(/^cop\./);
    expect(key as string).not.toMatch(/^authority\./);
  });

  it("uses the `COP_*` env namespace, not the `AUTHORITY_*` env namespace", async () => {
    // Confirm by reading the resolver against the documented env name.
    // (The resolver source is the source of truth — this test pins the
    // public env name so a rename would fail loudly.)
    mockGetServerConfigValue.mockResolvedValue(null);
    process.env.COP_CLINICAL_INVARIANT_ENFORCE_V1 = "shadow";
    expect(await resolveClinicalInvariantEnforcementMode("clinic-ns")).toBe("shadow");
  });
});
