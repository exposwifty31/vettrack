/**
 * T-23b · Readiness tier-bucket helper (R-EQ-F2 · small-02)
 *
 * Pure map from the six EquipmentStatus tokens to a 3-tier readiness bucket.
 * Pinned mapping:
 *   ready     <- ok, sterilized
 *   caution   <- maintenance, needs_attention
 *   not_ready <- critical, issue
 */
import { describe, it, expect } from "vitest";
import type { EquipmentStatus } from "@/types/equipment";
import {
  getReadinessTier,
  type ReadinessTier,
} from "@/lib/equipment-readiness-tier";

describe("getReadinessTier", () => {
  // Exhaustive over the EquipmentStatus union: adding a 7th status token
  // without updating this map fails typecheck (satisfies Record<...>).
  const expected = {
    ok: "ready",
    sterilized: "ready",
    maintenance: "caution",
    needs_attention: "caution",
    critical: "not_ready",
    issue: "not_ready",
  } satisfies Record<EquipmentStatus, ReadinessTier>;

  for (const [status, tier] of Object.entries(expected) as [
    EquipmentStatus,
    ReadinessTier,
  ][]) {
    it(`maps "${status}" to "${tier}"`, () => {
      expect(getReadinessTier(status)).toBe(tier);
    });
  }

  it("covers all six EquipmentStatus tokens exactly", () => {
    expect(Object.keys(expected).sort()).toEqual(
      ["ok", "issue", "maintenance", "sterilized", "critical", "needs_attention"].sort(),
    );
  });
});
