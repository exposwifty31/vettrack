/**
 * D1 — the custody-roster resolver's outage contract. This family diverges
 * from Strategy A (throw → env default) ON PURPOSE: its env default may be
 * `enforce`, so a config-store outage falling back to the env would 403
 * off-shift clinicians exactly when nothing can be fixed. A read failure
 * resolves `off`, UNCACHED, so recovery re-reads immediately.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetServerConfigValue = vi.hoisted(() => vi.fn());
vi.mock("../server/lib/server-config.js", () => ({
  getServerConfigValue: (...args: unknown[]) => mockGetServerConfigValue(...args),
}));

import {
  __resetEnforcementConfigCacheForTests,
  enforcementConfigLogger,
  resolveCustodyRosterEnforcementMode,
} from "../server/lib/authority/enforcement/config.js";

/** Arrange: env=enforce + a rejecting store; returns a restore function. */
function armEnforcedOutage(): () => void {
  const prev = process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1;
  process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1 = "enforce";
  mockGetServerConfigValue.mockRejectedValue(new Error("store down"));
  return () => {
    if (prev === undefined) {
      delete process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1;
    } else {
      process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1 = prev;
    }
  };
}

describe("custody-roster resolver — envelope outage", () => {
  beforeEach(() => {
    mockGetServerConfigValue.mockReset();
    __resetEnforcementConfigCacheForTests();
  });

  it("fails OPEN to off on a read failure, even with env=enforce", async () => {
    const restore = armEnforcedOutage();
    const spy = vi.spyOn(enforcementConfigLogger, "custodyRosterReadFailed").mockImplementation(() => {});
    try {
      await expect(resolveCustodyRosterEnforcementMode("c1")).resolves.toBe("off");
    } finally {
      spy.mockRestore();
      restore();
    }
  });

  it("emits the structured read-failure event", async () => {
    const restore = armEnforcedOutage();
    const spy = vi.spyOn(enforcementConfigLogger, "custodyRosterReadFailed").mockImplementation(() => {});
    try {
      await resolveCustodyRosterEnforcementMode("c1");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ clinicId: "c1", error: "store down" }),
      );
    } finally {
      spy.mockRestore();
      restore();
    }
  });

  it("does not cache the failure — the store recovering is honoured at once", async () => {
    const restore = armEnforcedOutage();
    const spy = vi.spyOn(enforcementConfigLogger, "custodyRosterReadFailed").mockImplementation(() => {});
    try {
      await expect(resolveCustodyRosterEnforcementMode("c1")).resolves.toBe("off");
      mockGetServerConfigValue.mockResolvedValue("shadow");
      await expect(resolveCustodyRosterEnforcementMode("c1")).resolves.toBe("shadow");
    } finally {
      spy.mockRestore();
      restore();
    }
  });

  it("a clean read still honours the per-clinic override and caches it", async () => {
    mockGetServerConfigValue.mockResolvedValue("enforce");
    await expect(resolveCustodyRosterEnforcementMode("c2")).resolves.toBe("enforce");
    mockGetServerConfigValue.mockResolvedValue("off");
    // cached within TTL — the second read serves the cached enforce
    await expect(resolveCustodyRosterEnforcementMode("c2")).resolves.toBe("enforce");
  });
});
