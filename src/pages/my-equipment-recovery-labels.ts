import type { EquipmentRecoverySnapshot } from "@/lib/equipment-recovery-state";

/** i18n keys under `myEquipmentPage` for recovery attention badges. */
export type MyEquipmentRecoveryBadgeKey =
  | "recoveryBadgeStale"
  | "recoveryBadgeVeryStale"
  | "recoveryBadgeCheckedOutLong";

/**
 * Maps a recovery snapshot to a bounded badge label key, or null when no badge.
 * Checkout-too-long wins over stale tiers (matches `recoveryAttentionRank`).
 */
export function resolveMyEquipmentRecoveryBadgeKey(
  snapshot: EquipmentRecoverySnapshot,
): MyEquipmentRecoveryBadgeKey | null {
  if (!snapshot.needsAttention) return null;
  if (snapshot.isCheckedOutTooLong) return "recoveryBadgeCheckedOutLong";
  if (snapshot.stalenessLevel === "very_stale") return "recoveryBadgeVeryStale";
  if (snapshot.isStale) return "recoveryBadgeStale";
  return null;
}
