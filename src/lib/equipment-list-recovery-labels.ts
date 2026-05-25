import type { EquipmentRecoverySource } from "@/lib/equipment-recovery-adapter";
import {
  compareRecoveryAttention,
  deriveEquipmentRecoverySnapshotFromSource,
  filterEquipmentNeedingAttention,
} from "@/lib/equipment-recovery-adapter";
import type { EquipmentRecoverySnapshot } from "@/lib/equipment-recovery-state";
import { resolveMyEquipmentRecoveryBadgeKey } from "@/pages/my-equipment-recovery-labels";

/** i18n keys under `equipmentList` for recovery attention badges (same suffixes as My Equipment). */
export type EquipmentListRecoveryBadgeKey =
  | "recoveryBadgeStale"
  | "recoveryBadgeVeryStale"
  | "recoveryBadgeCheckedOutLong";

/** Maps snapshot → equipmentList badge key; null when no badge (same precedence as My Equipment / Detail). */
export function resolveEquipmentListRecoveryBadgeKey(
  snapshot: EquipmentRecoverySnapshot,
): EquipmentListRecoveryBadgeKey | null {
  return resolveMyEquipmentRecoveryBadgeKey(snapshot);
}

/** Builds the displayed list: optional attention-only filter + urgency sort when recovery UI is enabled. */
export function buildEquipmentListForDisplay<T extends EquipmentRecoverySource>(
  filtered: T[],
  options: { flag: boolean; attentionOnly: boolean },
  now?: Date,
): T[] {
  if (!options.flag) return filtered;
  let list = filtered;
  if (options.attentionOnly) {
    list = filterEquipmentNeedingAttention(list, now);
  }
  return [...list].sort((a, b) =>
    compareRecoveryAttention(
      deriveEquipmentRecoverySnapshotFromSource(a, now),
      deriveEquipmentRecoverySnapshotFromSource(b, now),
    ),
  );
}
