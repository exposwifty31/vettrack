import type { EquipmentRecoverySnapshot } from "@/lib/equipment-recovery-state";
import { resolveMyEquipmentRecoveryBadgeKey } from "./my-equipment-recovery-labels";

/** i18n keys under `pilotHomePage` for recovery attention badges. */
export type PilotHomeRecoveryBadgeKey =
  | "recoveryBadgeStale"
  | "recoveryBadgeVeryStale"
  | "recoveryBadgeCheckedOutLong";

/**
 * Maps a recovery snapshot to a bounded badge label key, or null when no badge.
 * Checkout-too-long wins over stale tiers (matches `recoveryAttentionRank`).
 */
export function resolvePilotHomeRecoveryBadgeKey(
  snapshot: EquipmentRecoverySnapshot,
): PilotHomeRecoveryBadgeKey | null {
  return resolveMyEquipmentRecoveryBadgeKey(snapshot);
}

/** i18n keys under `pilotHomePage` for worth-checking / search sublines when recovery UI is on. */
export type PilotHomeRecoverySublineKey =
  | "recoverySublineStale"
  | "recoverySublineVeryStale"
  | "recoverySublineCheckedOutLong"
  | "recoverySublineNeverConfirmed";

/**
 * Maps snapshot → subline key for attention rows; null when no attention subline.
 * Precedence: checkout-too-long > very_stale > stale > never confirmed.
 */
export function resolvePilotHomeRecoverySublineKey(
  snapshot: EquipmentRecoverySnapshot,
): PilotHomeRecoverySublineKey | null {
  if (!snapshot.needsAttention) return null;
  if (snapshot.isCheckedOutTooLong) return "recoverySublineCheckedOutLong";
  if (snapshot.stalenessLevel === "very_stale") return "recoverySublineVeryStale";
  if (snapshot.isStale) return "recoverySublineStale";
  if (snapshot.confirmSource === "none") return "recoverySublineNeverConfirmed";
  return "recoverySublineStale";
}

/** Dot indicator class for attention tier (checkout > very_stale > stale). */
export function pilotHomeRecoveryDotClass(snapshot: EquipmentRecoverySnapshot): string {
  if (!snapshot.needsAttention) return "bg-amber-400";
  if (snapshot.isCheckedOutTooLong) return "bg-red-500";
  if (snapshot.stalenessLevel === "very_stale") return "bg-red-400";
  return "bg-amber-400";
}
