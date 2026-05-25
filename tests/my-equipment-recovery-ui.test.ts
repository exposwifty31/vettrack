import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  STALE_MS,
  VERY_STALE_MS,
} from "../src/lib/equipment-recovery-thresholds";
import { deriveEquipmentRecoverySnapshotFromSource } from "../src/lib/equipment-recovery-adapter";
import { resolveMyEquipmentRecoveryBadgeKey } from "../src/pages/my-equipment-recovery-labels";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

describe("resolveMyEquipmentRecoveryBadgeKey", () => {
  it("returns null when needsAttention is false", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(1_000) },
      NOW,
    );
    expect(snapshot.needsAttention).toBe(false);
    expect(resolveMyEquipmentRecoveryBadgeKey(snapshot)).toBeNull();
  });

  it("returns recoveryBadgeStale for stale confirm tier", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(STALE_MS) },
      NOW,
    );
    expect(snapshot.isStale).toBe(true);
    expect(snapshot.stalenessLevel).toBe("stale");
    expect(resolveMyEquipmentRecoveryBadgeKey(snapshot)).toBe("recoveryBadgeStale");
  });

  it("returns recoveryBadgeVeryStale for very_stale tier", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(VERY_STALE_MS) },
      NOW,
    );
    expect(snapshot.stalenessLevel).toBe("very_stale");
    expect(resolveMyEquipmentRecoveryBadgeKey(snapshot)).toBe("recoveryBadgeVeryStale");
  });

  it("returns recoveryBadgeCheckedOutLong when checkout is too long", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      {
        lastSeen: iso(1_000),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
      NOW,
    );
    expect(snapshot.isCheckedOutTooLong).toBe(true);
    expect(resolveMyEquipmentRecoveryBadgeKey(snapshot)).toBe(
      "recoveryBadgeCheckedOutLong",
    );
  });

  it("prefers checkout-too-long over stale when both apply", () => {
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
    expect(resolveMyEquipmentRecoveryBadgeKey(snapshot)).toBe(
      "recoveryBadgeCheckedOutLong",
    );
  });
});
