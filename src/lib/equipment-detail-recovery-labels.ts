import type { EquipmentRecoverySnapshot } from "@/lib/equipment-recovery-state";
import { resolveMyEquipmentRecoveryBadgeKey } from "@/pages/my-equipment-recovery-labels";

/** i18n keys under `equipmentDetail` for recovery attention badges (same suffixes as My Equipment). */
export type EquipmentDetailRecoveryBadgeKey =
  | "recoveryBadgeStale"
  | "recoveryBadgeVeryStale"
  | "recoveryBadgeCheckedOutLong";

/** i18n keys under `equipmentDetail` for recovery attention callouts. */
export type EquipmentDetailRecoveryCalloutKey =
  | "recoveryAttentionCalloutStale"
  | "recoveryAttentionCalloutVeryStale"
  | "recoveryAttentionCalloutCheckedOutLong";

/** Maps snapshot → equipmentDetail badge key; null when no badge (same precedence as My Equipment). */
export function resolveEquipmentDetailRecoveryBadgeKey(
  snapshot: EquipmentRecoverySnapshot,
): EquipmentDetailRecoveryBadgeKey | null {
  return resolveMyEquipmentRecoveryBadgeKey(snapshot);
}

/**
 * Maps snapshot → equipmentDetail callout key; null when no callout.
 * Precedence: checkout-too-long > very_stale > stale (matches badge resolver).
 */
export function resolveEquipmentDetailRecoveryCalloutKey(
  snapshot: EquipmentRecoverySnapshot,
): EquipmentDetailRecoveryCalloutKey | null {
  if (!snapshot.needsAttention) return null;
  if (snapshot.isCheckedOutTooLong) return "recoveryAttentionCalloutCheckedOutLong";
  if (snapshot.stalenessLevel === "very_stale") return "recoveryAttentionCalloutVeryStale";
  if (snapshot.isStale) return "recoveryAttentionCalloutStale";
  return null;
}
