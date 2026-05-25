import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  STALE_MS,
  VERY_STALE_MS,
} from "../src/lib/equipment-recovery-thresholds";
import { deriveEquipmentRecoverySnapshotFromSource } from "../src/lib/equipment-recovery-adapter";
import {
  resolveEquipmentDetailRecoveryBadgeKey,
  resolveEquipmentDetailRecoveryCalloutKey,
} from "../src/lib/equipment-detail-recovery-labels";
import { resolveMyEquipmentRecoveryBadgeKey } from "../src/pages/my-equipment-recovery-labels";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

describe("resolveEquipmentDetailRecoveryBadgeKey", () => {
  it("matches My Equipment resolver output (equipmentDetail namespace keys)", () => {
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
      expect(resolveEquipmentDetailRecoveryBadgeKey(snapshot)).toBe(
        resolveMyEquipmentRecoveryBadgeKey(snapshot),
      );
    }
  });

  it("returns null when needsAttention is false", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(1_000) },
      NOW,
    );
    expect(snapshot.needsAttention).toBe(false);
    expect(resolveEquipmentDetailRecoveryBadgeKey(snapshot)).toBeNull();
  });
});

describe("resolveEquipmentDetailRecoveryCalloutKey", () => {
  it("returns null when needsAttention is false", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(1_000) },
      NOW,
    );
    expect(resolveEquipmentDetailRecoveryCalloutKey(snapshot)).toBeNull();
  });

  it("returns recoveryAttentionCalloutStale for stale tier", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(STALE_MS) },
      NOW,
    );
    expect(resolveEquipmentDetailRecoveryCalloutKey(snapshot)).toBe(
      "recoveryAttentionCalloutStale",
    );
  });

  it("returns recoveryAttentionCalloutVeryStale for very_stale tier", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(VERY_STALE_MS) },
      NOW,
    );
    expect(resolveEquipmentDetailRecoveryCalloutKey(snapshot)).toBe(
      "recoveryAttentionCalloutVeryStale",
    );
  });

  it("returns recoveryAttentionCalloutCheckedOutLong when checkout is too long", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      {
        lastSeen: iso(1_000),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
      NOW,
    );
    expect(resolveEquipmentDetailRecoveryCalloutKey(snapshot)).toBe(
      "recoveryAttentionCalloutCheckedOutLong",
    );
  });

  it("prefers checkout-too-long callout over stale when both apply", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      {
        lastSeen: iso(VERY_STALE_MS),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
      NOW,
    );
    expect(snapshot.isStale).toBe(true);
    expect(snapshot.isCheckedOutTooLong).toBe(true);
    expect(resolveEquipmentDetailRecoveryCalloutKey(snapshot)).toBe(
      "recoveryAttentionCalloutCheckedOutLong",
    );
    expect(resolveEquipmentDetailRecoveryBadgeKey(snapshot)).toBe(
      "recoveryBadgeCheckedOutLong",
    );
  });
});
