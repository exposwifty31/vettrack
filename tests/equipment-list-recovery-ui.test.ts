import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  STALE_MS,
  VERY_STALE_MS,
} from "../src/lib/equipment-recovery-thresholds";
import {
  compareRecoveryAttention,
  deriveEquipmentRecoverySnapshotFromSource,
} from "../src/lib/equipment-recovery-adapter";
import {
  buildEquipmentListForDisplay,
  resolveEquipmentListRecoveryBadgeKey,
} from "../src/lib/equipment-list-recovery-labels";
import { resolveMyEquipmentRecoveryBadgeKey } from "../src/pages/my-equipment-recovery-labels";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

type Row = {
  id: string;
  lastSeen?: string | null;
  lastVerifiedAt?: string | null;
  checkedOutAt?: string | null;
  custodyState?: string | null;
  status?: string;
};

describe("resolveEquipmentListRecoveryBadgeKey", () => {
  it("matches My Equipment resolver output (equipmentList namespace keys)", () => {
    const sources = [
      { lastSeen: iso(1_000) },
      { lastSeen: iso(STALE_MS) },
      { lastSeen: iso(VERY_STALE_MS) },
      {
        lastSeen: iso(VERY_STALE_MS),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
    ];
    for (const source of sources) {
      const snapshot = deriveEquipmentRecoverySnapshotFromSource(source, NOW);
      expect(resolveEquipmentListRecoveryBadgeKey(snapshot)).toBe(
        resolveMyEquipmentRecoveryBadgeKey(snapshot),
      );
    }
  });

  it("returns null when needsAttention is false (badges only — no callout on list)", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(1_000) },
      NOW,
    );
    expect(snapshot.needsAttention).toBe(false);
    expect(resolveEquipmentListRecoveryBadgeKey(snapshot)).toBeNull();
  });
});

describe("buildEquipmentListForDisplay", () => {
  const rows: Row[] = [
    { id: "ok", lastSeen: iso(1_000) },
    { id: "stale", lastSeen: iso(STALE_MS) },
    { id: "very", lastSeen: iso(VERY_STALE_MS) },
    {
      id: "checkout",
      lastSeen: iso(1_000),
      checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
      custodyState: "checked_out",
      status: "ok",
    },
  ];

  it("returns input unchanged when flag is off", () => {
    expect(
      buildEquipmentListForDisplay(rows, { flag: false, attentionOnly: false }, NOW),
    ).toBe(rows);
  });

  it("sorts by recovery urgency when flag is on", () => {
    const sorted = buildEquipmentListForDisplay(
      rows,
      { flag: true, attentionOnly: false },
      NOW,
    );
    const ranks = sorted.map((r) =>
      deriveEquipmentRecoverySnapshotFromSource(r, NOW),
    );
    for (let i = 0; i < ranks.length - 1; i++) {
      expect(compareRecoveryAttention(ranks[i], ranks[i + 1])).toBeLessThanOrEqual(0);
    }
    expect(sorted.map((r) => r.id)).toEqual(["very", "checkout", "stale", "ok"]);
  });

  it("narrows to needs-attention rows when attentionOnly is on", () => {
    const narrowed = buildEquipmentListForDisplay(
      rows,
      { flag: true, attentionOnly: true },
      NOW,
    );
    expect(narrowed.map((r) => r.id)).toEqual(["very", "checkout", "stale"]);
  });
});
