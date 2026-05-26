import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  STALE_MS,
  VERY_STALE_MS,
} from "../src/lib/equipment-recovery-thresholds";
import type { EquipmentRecoverySource } from "../src/lib/equipment-recovery-adapter";
import {
  derivePersonalEquipmentDebt,
  type PersonalDebtTier,
  type PersonalEquipmentDebtSnapshot,
} from "../src/lib/equipment-personal-debt";
import {
  resolvePersonalDebtBannerKey,
  personalDebtBreakdownSegments,
} from "../src/pages/my-equipment-personal-debt-labels";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

function item(overrides: Partial<EquipmentRecoverySource> & { id?: string }): EquipmentRecoverySource {
  return {
    lastSeen: iso(1_000),
    ...overrides,
  };
}

describe("derivePersonalEquipmentDebt", () => {
  it("returns zeros and dominant none for an empty list", () => {
    const snapshot = derivePersonalEquipmentDebt([], NOW);
    expect(snapshot).toEqual({
      totalCheckedOut: 0,
      attentionCount: 0,
      byTier: { checkedOutLong: 0, veryStale: 0, stale: 0 },
      dominantTier: "none",
    });
    expect(resolvePersonalDebtBannerKey(snapshot)).toBeNull();
  });

  it("ignores items that do not need attention", () => {
    const snapshot = derivePersonalEquipmentDebt(
      [
        item({ lastSeen: iso(1_000) }),
        item({ lastSeen: iso(2_000) }),
      ],
      NOW,
    );
    expect(snapshot.totalCheckedOut).toBe(2);
    expect(snapshot.attentionCount).toBe(0);
    expect(snapshot.dominantTier).toBe("none");
  });

  it("counts each attention item in exactly one tier bucket", () => {
    const snapshot = derivePersonalEquipmentDebt(
      [
        item({ lastSeen: iso(STALE_MS) }),
        item({ lastSeen: iso(VERY_STALE_MS) }),
        item({
          lastSeen: iso(1_000),
          checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
          custodyState: "checked_out",
          status: "ok",
        }),
      ],
      NOW,
    );
    expect(snapshot.attentionCount).toBe(3);
    expect(snapshot.byTier).toEqual({
      checkedOutLong: 1,
      veryStale: 1,
      stale: 1,
    });
  });

  it("assigns checkout-too-long over stale tiers for a single item", () => {
    const snapshot = derivePersonalEquipmentDebt(
      [
        item({
          lastSeen: iso(VERY_STALE_MS),
          checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
          custodyState: "checked_out",
          status: "ok",
        }),
      ],
      NOW,
    );
    expect(snapshot.byTier).toEqual({
      checkedOutLong: 1,
      veryStale: 0,
      stale: 0,
    });
  });

  it("uses dominant tier precedence: checked_out_long > very_stale > stale", () => {
    const cases: Array<{
      byTier: PersonalEquipmentDebtSnapshot["byTier"];
      dominant: PersonalDebtTier;
    }> = [
      {
        byTier: { checkedOutLong: 1, veryStale: 2, stale: 3 },
        dominant: "checked_out_long",
      },
      {
        byTier: { checkedOutLong: 0, veryStale: 1, stale: 5 },
        dominant: "very_stale",
      },
      {
        byTier: { checkedOutLong: 0, veryStale: 0, stale: 2 },
        dominant: "stale",
      },
    ];

    for (const { byTier, dominant } of cases) {
      const items: EquipmentRecoverySource[] = [];
      for (let i = 0; i < byTier.checkedOutLong; i++) {
        items.push(
          item({
            lastSeen: iso(VERY_STALE_MS),
            checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
            custodyState: "checked_out",
            status: "ok",
          }),
        );
      }
      for (let i = 0; i < byTier.veryStale; i++) {
        items.push(item({ lastSeen: iso(VERY_STALE_MS) }));
      }
      for (let i = 0; i < byTier.stale; i++) {
        items.push(item({ lastSeen: iso(STALE_MS) }));
      }

      const snapshot = derivePersonalEquipmentDebt(items, NOW);
      expect(snapshot.dominantTier).toBe(dominant);
    }
  });

  it("maps dominant tier to bounded banner keys", () => {
    const longOnly = derivePersonalEquipmentDebt(
      [
        item({
          lastSeen: iso(1_000),
          checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
          custodyState: "checked_out",
          status: "ok",
        }),
      ],
      NOW,
    );
    expect(resolvePersonalDebtBannerKey(longOnly)).toBe(
      "personalDebtBannerCheckedOutLong",
    );

    const veryStaleOnly = derivePersonalEquipmentDebt(
      [item({ lastSeen: iso(VERY_STALE_MS) })],
      NOW,
    );
    expect(resolvePersonalDebtBannerKey(veryStaleOnly)).toBe(
      "personalDebtBannerVeryStale",
    );

    const staleOnly = derivePersonalEquipmentDebt(
      [item({ lastSeen: iso(STALE_MS) })],
      NOW,
    );
    expect(resolvePersonalDebtBannerKey(staleOnly)).toBe("personalDebtBannerStale");
  });

  it("exposes breakdown segments in severity order", () => {
    const snapshot = derivePersonalEquipmentDebt(
      [
        item({ lastSeen: iso(STALE_MS) }),
        item({ lastSeen: iso(VERY_STALE_MS) }),
        item({
          lastSeen: iso(1_000),
          checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
          custodyState: "checked_out",
          status: "ok",
        }),
      ],
      NOW,
    );
    expect(personalDebtBreakdownSegments(snapshot).map((s) => s.key)).toEqual([
      "personalDebtBreakdownCheckedOutLong",
      "personalDebtBreakdownVeryStale",
      "personalDebtBreakdownStale",
    ]);
  });
});
