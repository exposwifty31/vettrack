import type { EquipmentRecoverySource } from "@/lib/equipment-recovery-adapter";
import { deriveEquipmentRecoverySnapshotFromSource } from "@/lib/equipment-recovery-adapter";
import type { EquipmentRecoverySnapshot } from "@/lib/equipment-recovery-state";

export type PersonalDebtTier =
  | "checked_out_long"
  | "very_stale"
  | "stale"
  | "none";

export interface PersonalEquipmentDebtSnapshot {
  totalCheckedOut: number;
  attentionCount: number;
  byTier: {
    checkedOutLong: number;
    veryStale: number;
    stale: number;
  };
  /** Highest-severity tier present among attention items, or "none". */
  dominantTier: PersonalDebtTier;
}

function tierForAttentionSnapshot(snapshot: EquipmentRecoverySnapshot): PersonalDebtTier {
  if (!snapshot.needsAttention) return "none";
  if (snapshot.isCheckedOutTooLong) return "checked_out_long";
  if (snapshot.stalenessLevel === "very_stale") return "very_stale";
  if (snapshot.isStale) return "stale";
  return "stale";
}

function resolveDominantTier(byTier: PersonalEquipmentDebtSnapshot["byTier"]): PersonalDebtTier {
  if (byTier.checkedOutLong > 0) return "checked_out_long";
  if (byTier.veryStale > 0) return "very_stale";
  if (byTier.stale > 0) return "stale";
  return "none";
}

/** User-scoped recovery debt over items already checked out to the current user. */
export function derivePersonalEquipmentDebt(
  items: EquipmentRecoverySource[],
  now?: Date,
): PersonalEquipmentDebtSnapshot {
  const byTier = { checkedOutLong: 0, veryStale: 0, stale: 0 };
  let attentionCount = 0;

  for (const item of items) {
    const snapshot = deriveEquipmentRecoverySnapshotFromSource(item, now);
    if (!snapshot.needsAttention) continue;
    attentionCount += 1;
    const tier = tierForAttentionSnapshot(snapshot);
    if (tier === "checked_out_long") byTier.checkedOutLong += 1;
    else if (tier === "very_stale") byTier.veryStale += 1;
    else if (tier === "stale") byTier.stale += 1;
  }

  return {
    totalCheckedOut: items.length,
    attentionCount,
    byTier,
    dominantTier: resolveDominantTier(byTier),
  };
}
