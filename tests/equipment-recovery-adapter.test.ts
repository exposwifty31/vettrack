import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  RECENTLY_CONFIRMED_MS,
  STALE_MS,
  VERY_STALE_MS,
} from "../src/lib/equipment-recovery-thresholds";
import {
  compareRecoveryAttention,
  deriveEquipmentRecoverySnapshotFromSource,
  filterEquipmentNeedingAttention,
  recoveryAttentionRank,
  toEquipmentRecoveryInput,
  type EquipmentRecoverySource,
} from "../src/lib/equipment-recovery-adapter";
import {
  deriveEquipmentRecoverySnapshot,
} from "../src/lib/equipment-recovery-state";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function atOffsetMs(offsetMs: number): Date {
  return new Date(NOW.getTime() - offsetMs);
}

function iso(d: Date): string {
  return d.toISOString();
}

describe("toEquipmentRecoveryInput", () => {
  it("maps all EquipmentRecoverySource fields onto recovery input", () => {
    const source: EquipmentRecoverySource = {
      lastSeen: iso(atOffsetMs(1_000)),
      lastVerifiedAt: iso(atOffsetMs(2_000)),
      checkedOutAt: iso(atOffsetMs(3_000)),
      custodyState: "checked_out",
      status: "ok",
    };
    expect(toEquipmentRecoveryInput(source)).toEqual({
      lastSeen: source.lastSeen,
      lastVerifiedAt: source.lastVerifiedAt,
      checkedOutAt: source.checkedOutAt,
      custodyState: "checked_out",
      status: "ok",
    });
  });
});

describe("deriveEquipmentRecoverySnapshotFromSource", () => {
  it("matches manual toEquipmentRecoveryInput + deriveEquipmentRecoverySnapshot", () => {
    const source: EquipmentRecoverySource = {
      lastSeen: iso(atOffsetMs(STALE_MS)),
      lastVerifiedAt: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
      checkedOutAt: iso(atOffsetMs(CHECKED_OUT_TOO_LONG_MS)),
      custodyState: "checked_out",
      status: "needs_attention",
    };
    const fromWrapper = deriveEquipmentRecoverySnapshotFromSource(source, NOW);
    const manual = deriveEquipmentRecoverySnapshot(
      toEquipmentRecoveryInput(source),
      NOW,
    );
    expect(fromWrapper).toEqual(manual);
  });
});

describe("recoveryAttentionRank", () => {
  it("ranks stale below very_stale when both need attention", () => {
    const stale = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(STALE_MS)) },
      NOW,
    );
    const veryStale = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(VERY_STALE_MS)) },
      NOW,
    );
    expect(stale.stalenessLevel).toBe("stale");
    expect(veryStale.stalenessLevel).toBe("very_stale");
    expect(recoveryAttentionRank(stale)).toBeLessThan(recoveryAttentionRank(veryStale));
  });

  it("ranks recent confirm tier below stale when neither needs attention", () => {
    const recent = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)), custodyState: "docked" },
      NOW,
    );
    const stale = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(STALE_MS)) },
      NOW,
    );
    expect(recent.stalenessLevel).toBe("recent");
    expect(recent.needsAttention).toBe(false);
    expect(stale.needsAttention).toBe(true);
    expect(recoveryAttentionRank(recent)).toBeLessThan(recoveryAttentionRank(stale));
  });

  it("ranks checkout-too-long above stale when confirm is fresh", () => {
    const checkoutOnly = deriveEquipmentRecoverySnapshotFromSource(
      {
        custodyState: "checked_out",
        checkedOutAt: iso(atOffsetMs(CHECKED_OUT_TOO_LONG_MS)),
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
      },
      NOW,
    );
    const staleOnly = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(STALE_MS)) },
      NOW,
    );
    expect(checkoutOnly.isCheckedOutTooLong).toBe(true);
    expect(checkoutOnly.isStale).toBe(false);
    expect(recoveryAttentionRank(checkoutOnly)).toBeGreaterThan(
      recoveryAttentionRank(staleOnly),
    );
  });

  it("does not elevate checkout-too-long rank when not checked out", () => {
    const longCheckoutNotActive = deriveEquipmentRecoverySnapshotFromSource(
      {
        custodyState: "returned",
        checkedOutAt: iso(atOffsetMs(CHECKED_OUT_TOO_LONG_MS)),
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
      },
      NOW,
    );
    expect(longCheckoutNotActive.isCheckedOutTooLong).toBe(false);
    expect(longCheckoutNotActive.needsAttention).toBe(false);
    expect(recoveryAttentionRank(longCheckoutNotActive)).toBe(0);
  });

  it("ranks needsAttention false last", () => {
    const ok = deriveEquipmentRecoverySnapshotFromSource(
      {
        custodyState: "checked_out",
        checkedOutAt: iso(atOffsetMs(CHECKED_OUT_TOO_LONG_MS - 1)),
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
      },
      NOW,
    );
    const urgent = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(VERY_STALE_MS)) },
      NOW,
    );
    expect(ok.needsAttention).toBe(false);
    expect(recoveryAttentionRank(ok)).toBe(0);
    expect(recoveryAttentionRank(urgent)).toBeGreaterThan(0);
  });
});

describe("compareRecoveryAttention", () => {
  it("orders snapshots by attention rank (more urgent first)", () => {
    const recentCheckout = deriveEquipmentRecoverySnapshotFromSource(
      {
        custodyState: "checked_out",
        checkedOutAt: iso(atOffsetMs(CHECKED_OUT_TOO_LONG_MS)),
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
      },
      NOW,
    );
    const stale = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(STALE_MS)) },
      NOW,
    );
    const veryStale = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(atOffsetMs(VERY_STALE_MS)) },
      NOW,
    );
    const ok = deriveEquipmentRecoverySnapshotFromSource(
      {
        custodyState: "docked",
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
      },
      NOW,
    );

    const sorted = [ok, stale, recentCheckout, veryStale].sort(compareRecoveryAttention);
    expect(sorted).toEqual([veryStale, recentCheckout, stale, ok]);
  });
});

describe("filterEquipmentNeedingAttention", () => {
  it("returns only items with needsAttention on a mixed fixture list", () => {
    const items: EquipmentRecoverySource[] = [
      {
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
        custodyState: "docked",
        status: "ok",
      },
      { lastSeen: iso(atOffsetMs(STALE_MS)), status: "ok" },
      {
        custodyState: "checked_out",
        checkedOutAt: iso(atOffsetMs(CHECKED_OUT_TOO_LONG_MS)),
        lastSeen: iso(atOffsetMs(RECENTLY_CONFIRMED_MS - 1)),
        status: "ok",
      },
      {},
    ];

    const filtered = filterEquipmentNeedingAttention(items, NOW);
    expect(filtered).toHaveLength(3);
    expect(filtered).not.toContainEqual(items[0]);
    expect(filtered).toContainEqual(items[1]);
    expect(filtered).toContainEqual(items[2]);
    expect(filtered).toContainEqual(items[3]);
  });
});
