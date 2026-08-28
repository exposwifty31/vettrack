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
  resolveCustodyRosterEnforcementMode,
} from "../server/lib/authority/enforcement/config.js";

describe("custody-roster resolver — envelope outage", () => {
  beforeEach(() => {
    mockGetServerConfigValue.mockReset();
    __resetEnforcementConfigCacheForTests();
  });

  it("fails OPEN to off on a read failure — even with env=enforce — and does not cache it", async () => {
    const prev = process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1;
    process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1 = "enforce";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mockGetServerConfigValue.mockRejectedValue(new Error("store down"));
      await expect(resolveCustodyRosterEnforcementMode("c1")).resolves.toBe("off");
      expect(warn).toHaveBeenCalledWith(
        "[authority-enforcement]",
        expect.objectContaining({ event: "custody_roster_config_read_failed" }),
      );
      // The failure was NOT cached: the store recovering is honoured at once.
      mockGetServerConfigValue.mockResolvedValue("shadow");
      await expect(resolveCustodyRosterEnforcementMode("c1")).resolves.toBe("shadow");
    } finally {
      warn.mockRestore();
      if (prev === undefined) {
        delete process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1;
      } else {
        process.env.AUTHORITY_CUSTODY_ROSTER_ENFORCE_V1 = prev;
      }
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
