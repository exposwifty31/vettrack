import { describe, expect, it } from "vitest";
import {
  CHECKED_OUT_TOO_LONG_MS,
  RECENTLY_CONFIRMED_MS,
  STALE_MS,
  VERY_STALE_MS,
} from "../src/lib/equipment-recovery-thresholds";
import {
  deriveEquipmentRecoverySnapshot,
  isCheckedOutForRecovery,
  resolveEquipmentConfirm,
} from "../src/lib/equipment-recovery-state";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function atOffsetMs(offsetMs: number): Date {
  return new Date(NOW.getTime() - offsetMs);
}

describe("resolveEquipmentConfirm", () => {
  it("returns none when both timestamps are missing", () => {
    expect(resolveEquipmentConfirm({})).toEqual({ source: "none", at: null });
  });

  it("prefers last_verified when only verified is present", () => {
    const at = atOffsetMs(1_000);
    expect(resolveEquipmentConfirm({ lastVerifiedAt: at })).toEqual({
      source: "last_verified",
      at,
    });
  });

  it("prefers last_seen when only seen is present", () => {
    const at = atOffsetMs(2_000);
    expect(resolveEquipmentConfirm({ lastSeen: at })).toEqual({
      source: "last_seen",
      at,
    });
  });

  it("uses the newer timestamp when both are present (verified wins tie)", () => {
    const olderSeen = atOffsetMs(10_000);
    const newerVerified = atOffsetMs(5_000);
    expect(
      resolveEquipmentConfirm({
        lastSeen: olderSeen,
        lastVerifiedAt: newerVerified,
      }),
    ).toEqual({ source: "last_verified", at: newerVerified });

    const newerSeen = atOffsetMs(3_000);
    const olderVerified = atOffsetMs(8_000);
    expect(
      resolveEquipmentConfirm({
        lastSeen: newerSeen,
        lastVerifiedAt: olderVerified,
      }),
    ).toEqual({ source: "last_seen", at: newerSeen });
  });
});

describe("isCheckedOutForRecovery", () => {
  it("is true for checked_out custody", () => {
    expect(
      isCheckedOutForRecovery({ custodyState: "checked_out", checkedOutAt: null }),
    ).toBe(true);
  });

  it("is false for docked, returned, and untracked custody", () => {
    expect(isCheckedOutForRecovery({ custodyState: "docked" })).toBe(false);
    expect(isCheckedOutForRecovery({ custodyState: "returned" })).toBe(false);
    expect(isCheckedOutForRecovery({ custodyState: "untracked" })).toBe(false);
  });

  it("falls back to checkout timestamp when custody is absent", () => {
    expect(isCheckedOutForRecovery({ checkedOutAt: atOffsetMs(1) })).toBe(true);
    expect(isCheckedOutForRecovery({})).toBe(false);
  });

  it("does not treat returned custody as checked out even with checkout timestamp", () => {
    expect(
      isCheckedOutForRecovery({
        custodyState: "returned",
        checkedOutAt: atOffsetMs(CHECKED_OUT_TOO_LONG_MS),
      }),
    ).toBe(false);
  });
});

describe("deriveEquipmentRecoverySnapshot", () => {
  it("derives staleness from the resolved confirm timestamp", () => {
    const snapshot = deriveEquipmentRecoverySnapshot(
      { lastSeen: atOffsetMs(RECENTLY_CONFIRMED_MS - 1) },
      NOW,
    );
    expect(snapshot.stalenessLevel).toBe("recent");
    expect(snapshot.isStale).toBe(false);
    expect(snapshot.confirmSource).toBe("last_seen");
    expect(snapshot.confirmAt).toBe(atOffsetMs(RECENTLY_CONFIRMED_MS - 1).toISOString());
  });

  it("marks stale and needsAttention at stale threshold", () => {
    const snapshot = deriveEquipmentRecoverySnapshot(
      { lastVerifiedAt: atOffsetMs(STALE_MS) },
      NOW,
    );
    expect(snapshot.stalenessLevel).toBe("stale");
    expect(snapshot.isStale).toBe(true);
    expect(snapshot.needsAttention).toBe(true);
    expect(snapshot.confirmSource).toBe("last_verified");
  });

  it("uses very_stale tier past very stale threshold", () => {
    const snapshot = deriveEquipmentRecoverySnapshot(
      { lastSeen: atOffsetMs(VERY_STALE_MS) },
      NOW,
    );
    expect(snapshot.stalenessLevel).toBe("very_stale");
    expect(snapshot.isStale).toBe(true);
  });

  it("gates checked-out-too-long behind active checkout custody", () => {
    const longCheckout = atOffsetMs(CHECKED_OUT_TOO_LONG_MS);
    const freshConfirm = atOffsetMs(RECENTLY_CONFIRMED_MS - 1);

    const gatedOut = deriveEquipmentRecoverySnapshot(
      {
        custodyState: "checked_out",
        checkedOutAt: longCheckout,
        lastSeen: freshConfirm,
      },
      NOW,
    );
    expect(gatedOut.isCheckedOutTooLong).toBe(true);
    expect(gatedOut.needsAttention).toBe(true);
    expect(gatedOut.isStale).toBe(false);

    const notCheckedOut = deriveEquipmentRecoverySnapshot(
      {
        custodyState: "returned",
        checkedOutAt: longCheckout,
        lastSeen: freshConfirm,
      },
      NOW,
    );
    expect(notCheckedOut.isCheckedOutTooLong).toBe(false);
    expect(notCheckedOut.needsAttention).toBe(false);
  });

  it("does not flag checkout-too-long without checkout timestamp", () => {
    const snapshot = deriveEquipmentRecoverySnapshot(
      {
        custodyState: "checked_out",
        checkedOutAt: null,
        lastSeen: atOffsetMs(STALE_MS),
      },
      NOW,
    );
    expect(snapshot.isCheckedOutTooLong).toBe(false);
    expect(snapshot.needsAttention).toBe(true);
  });

  it("needsAttention is false when recent and checkout is within threshold", () => {
    const snapshot = deriveEquipmentRecoverySnapshot(
      {
        custodyState: "checked_out",
        checkedOutAt: atOffsetMs(CHECKED_OUT_TOO_LONG_MS - 1),
        lastSeen: atOffsetMs(RECENTLY_CONFIRMED_MS - 1),
      },
      NOW,
    );
    expect(snapshot.needsAttention).toBe(false);
    expect(snapshot.isCheckedOutTooLong).toBe(false);
    expect(snapshot.isStale).toBe(false);
  });

  it("conservative needsAttention when confirm is missing (very_stale)", () => {
    const snapshot = deriveEquipmentRecoverySnapshot({}, NOW);
    expect(snapshot.confirmSource).toBe("none");
    expect(snapshot.confirmAt).toBe(null);
    expect(snapshot.stalenessLevel).toBe("very_stale");
    expect(snapshot.needsAttention).toBe(true);
  });
});
