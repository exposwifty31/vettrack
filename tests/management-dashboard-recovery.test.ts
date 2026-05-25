import { describe, expect, it } from "vitest";
import type { Equipment } from "@/types";
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
  buildManagementRecoveryCriticalRows,
  resolveManagementRecoveryReasonKey,
} from "../src/lib/management-dashboard-recovery";

const NOW = new Date("2026-05-25T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

function row(
  partial: Partial<Equipment> & { id: string },
): Equipment {
  return {
    id: partial.id,
    name: partial.name ?? partial.id,
    status: partial.status ?? "ok",
    lastSeen: partial.lastSeen,
    lastVerifiedAt: partial.lastVerifiedAt,
    checkedOutAt: partial.checkedOutAt,
    custodyState: partial.custodyState,
    location: partial.location,
  } as Equipment;
}

describe("resolveManagementRecoveryReasonKey", () => {
  it("prefers checkout-too-long over very_stale and stale", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      {
        lastSeen: iso(VERY_STALE_MS),
        checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
        custodyState: "checked_out",
        status: "ok",
      },
      NOW,
    );
    expect(resolveManagementRecoveryReasonKey(snapshot)).toBe(
      "recoveryReasonCheckedOutLong",
    );
  });

  it("maps very_stale without checkout to recoveryReasonVeryStale", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(VERY_STALE_MS) },
      NOW,
    );
    expect(resolveManagementRecoveryReasonKey(snapshot)).toBe(
      "recoveryReasonVeryStale",
    );
  });

  it("maps stale to recoveryReasonStale", () => {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(
      { lastSeen: iso(STALE_MS) },
      NOW,
    );
    expect(resolveManagementRecoveryReasonKey(snapshot)).toBe("recoveryReasonStale");
  });
});

describe("buildManagementRecoveryCriticalRows", () => {
  const equipment: Equipment[] = [
    row({ id: "ok", lastSeen: iso(1_000) }),
    row({ id: "stale", lastSeen: iso(STALE_MS) }),
    row({ id: "very", lastSeen: iso(VERY_STALE_MS) }),
    row({
      id: "checkout",
      lastSeen: iso(1_000),
      checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
      custodyState: "checked_out",
    }),
    row({
      id: "issue-stale",
      status: "issue",
      lastSeen: iso(VERY_STALE_MS),
    }),
  ];

  it("orders rows by recovery urgency (very_stale, checkout, stale)", () => {
    const rows = buildManagementRecoveryCriticalRows(equipment, NOW);
    expect(rows.map((r) => r.id)).toEqual(["very", "checkout", "stale"]);
    const snapshots = rows.map((r) => {
      const eq = equipment.find((e) => e.id === r.id)!;
      return deriveEquipmentRecoverySnapshotFromSource(eq, NOW);
    });
    for (let i = 0; i < snapshots.length - 1; i++) {
      expect(compareRecoveryAttention(snapshots[i], snapshots[i + 1])).toBeLessThanOrEqual(
        0,
      );
    }
  });

  it("excludes issue-status equipment from recovery rows", () => {
    const rows = buildManagementRecoveryCriticalRows(equipment, NOW);
    expect(rows.some((r) => r.id === "issue-stale")).toBe(false);
  });

  it("assigns checkout reason when checkout and staleness both apply", () => {
    const rows = buildManagementRecoveryCriticalRows(
      [
        row({
          id: "both",
          lastSeen: iso(VERY_STALE_MS),
          checkedOutAt: iso(CHECKED_OUT_TOO_LONG_MS),
          custodyState: "checked_out",
        }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reasonKey).toBe("recoveryReasonCheckedOutLong");
    expect(rows[0].kind).toBe("recovery");
  });
});
