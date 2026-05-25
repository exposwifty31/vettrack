import type { Equipment } from "@/types";
import {
  compareRecoveryAttention,
  deriveEquipmentRecoverySnapshotFromSource,
  filterEquipmentNeedingAttention,
} from "@/lib/equipment-recovery-adapter";
import type { EquipmentRecoverySnapshot } from "@/lib/equipment-recovery-state";

export type ManagementRecoveryCriticalRow = {
  id: string;
  name: string;
  location?: string | null;
  /** Distinct from issue/missing legacy — for badge variant mapping */
  kind: "recovery";
  /** i18n key under managementDashboardPage */
  reasonKey:
    | "recoveryReasonStale"
    | "recoveryReasonVeryStale"
    | "recoveryReasonCheckedOutLong";
};

/**
 * Maps a recovery snapshot to a dashboard reason key.
 * Checkout-too-long wins over stale tiers (matches R3 / equipment list).
 */
export function resolveManagementRecoveryReasonKey(
  snapshot: EquipmentRecoverySnapshot,
): ManagementRecoveryCriticalRow["reasonKey"] | null {
  if (!snapshot.needsAttention) return null;
  if (snapshot.isCheckedOutTooLong) return "recoveryReasonCheckedOutLong";
  if (snapshot.stalenessLevel === "very_stale") return "recoveryReasonVeryStale";
  if (snapshot.isStale) return "recoveryReasonStale";
  return null;
}

/** Recovery attention rows for Management Dashboard Critical alerts (read-only). */
export function buildManagementRecoveryCriticalRows(
  equipment: Equipment[],
  now?: Date,
): ManagementRecoveryCriticalRow[] {
  const candidates = equipment.filter((eq) => eq.status !== "issue");
  const attention = filterEquipmentNeedingAttention(candidates, now);

  return [...attention]
    .sort((a, b) =>
      compareRecoveryAttention(
        deriveEquipmentRecoverySnapshotFromSource(a, now),
        deriveEquipmentRecoverySnapshotFromSource(b, now),
      ),
    )
    .map((eq) => {
      const snapshot = deriveEquipmentRecoverySnapshotFromSource(eq, now);
      const reasonKey = resolveManagementRecoveryReasonKey(snapshot);
      if (!reasonKey) {
        throw new Error(
          `buildManagementRecoveryCriticalRows: needsAttention without reasonKey (${eq.id})`,
        );
      }
      return {
        id: eq.id,
        name: eq.name,
        location: eq.location,
        kind: "recovery" as const,
        reasonKey,
      };
    });
}

export function isManagementRecoveryCriticalRow(
  item: ManagementRecoveryCriticalRow | { kind?: string; status?: string },
): item is ManagementRecoveryCriticalRow {
  return item.kind === "recovery";
}
