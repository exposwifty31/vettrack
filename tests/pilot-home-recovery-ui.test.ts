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
} from "../src/lib/equipment-recovery-adapter";
import {
  pilotHomeRecoveryDotClass,
  resolvePilotHomeRecoveryBadgeKey,
  resolvePilotHomeRecoverySublineKey,
} from "../src/pages/pilot-home-recovery-labels";
import { resolveMyEquipmentRecoveryBadgeKey } from "../src/pages/my-equipment-recovery-labels";

const NOW = new Date("2026-05-25T12:00:00.000Z");
const LEGACY_PILOT_STALE_MS = 4 * 60 * 60 * 1000;

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

function legacyPilotWorthChecking(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return true;
  return NOW.getTime() - new Date(lastSeen).getTime() > LEGACY_PILOT_STALE_MS;
}

describe("resolvePilotHomeRecoveryBadgeKey", () => {
  it("matches My Equipment resolver output", () => {
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
      expect(resolvePilotHomeRecoveryBadgeKey(snapshot)).toBe(
        resolveMyEquipmentRecoveryBadgeKey(snapshot),
      );
    }
  });

  it("returns null when needsAttention is false", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(1_000) },
      NOW,
    );
    expect(resolvePilotHomeRecoveryBadgeKey(snapshot)).toBeNull();
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
    expect(resolvePilotHomeRecoveryBadgeKey(snapshot)).toBe(
      "recoveryBadgeCheckedOutLong",
    );
  });
});

describe("resolvePilotHomeRecoverySublineKey", () => {
  it("prefers checkout-too-long subline over very_stale", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      {
        lastSeen: iso(VERY_STALE_MS),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
      NOW,
    );
    expect(resolvePilotHomeRecoverySublineKey(snapshot)).toBe(
      "recoverySublineCheckedOutLong",
    );
  });

  it("returns recoverySublineVeryStale for very_stale tier", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(VERY_STALE_MS) },
      NOW,
    );
    expect(resolvePilotHomeRecoverySublineKey(snapshot)).toBe(
      "recoverySublineVeryStale",
    );
  });
});

describe("pilotHomeRecoveryDotClass", () => {
  it("uses red dot for checkout-too-long and very_stale", () => {
    const checkout = deriveEquipmentRecoverySnapshotFromSource(
      {
        lastSeen: iso(1_000),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
      NOW,
    );
    const veryStale = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(VERY_STALE_MS) },
      NOW,
    );
    expect(pilotHomeRecoveryDotClass(checkout)).toContain("red");
    expect(pilotHomeRecoveryDotClass(veryStale)).toContain("red");
  });
});

describe("pilot home worth-checking flag gate", () => {
  const betweenLegacyAndRecovery = iso(LEGACY_PILOT_STALE_MS + 60_000);

  it("legacy 4h gate flags item recovery stack still treats as recent confirm", () => {
    expect(legacyPilotWorthChecking(betweenLegacyAndRecovery)).toBe(true);
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: betweenLegacyAndRecovery },
      NOW,
    );
    expect(snapshot.needsAttention).toBe(false);
    expect(
      filterEquipmentNeedingAttention(
        [{ id: "a", lastSeen: betweenLegacyAndRecovery }],
        NOW,
      ),
    ).toHaveLength(0);
  });

  it("recovery attention uses 24h stale threshold", () => {
    const atStale = iso(STALE_MS);
    expect(legacyPilotWorthChecking(atStale)).toBe(true);
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: atStale },
      NOW,
    );
    expect(snapshot.needsAttention).toBe(true);
    expect(
      filterEquipmentNeedingAttention([{ id: "b", lastSeen: atStale }], NOW),
    ).toHaveLength(1);
  });

  it("sorts checkout above stale when flag-on list ordering applies", () => {
    const rows = [
      { id: "stale", lastSeen: iso(STALE_MS) },
      {
        id: "checkout",
        lastSeen: iso(RECENTLY_CONFIRMED_MS + 1_000),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
    ];
    const sorted = filterEquipmentNeedingAttention(rows, NOW).sort((a, b) =>
      compareRecoveryAttention(
        deriveEquipmentRecoverySnapshotFromSource(a, NOW),
        deriveEquipmentRecoverySnapshotFromSource(b, NOW),
      ),
    );
    expect(sorted.map((r) => r.id)).toEqual(["checkout", "stale"]);
  });
});
