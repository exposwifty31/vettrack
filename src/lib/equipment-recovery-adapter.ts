/**
 * Equipment Recovery Layer — canonical mapping from API/list equipment rows
 * into recovery derivation (FND-02) without duplicating threshold math.
 */

import type { Equipment } from "@/types";
import {
  deriveEquipmentRecoverySnapshot,
  type EquipmentRecoveryInput,
  type EquipmentRecoverySnapshot,
} from "./equipment-recovery-state";

/** Minimal equipment fields for adapter input (no user/debt/billing). */
export type EquipmentRecoverySource = Pick<
  Equipment,
  "lastSeen" | "lastVerifiedAt" | "checkedOutAt" | "custodyState" | "status"
>;

/** Pure field mapping from list/API equipment into recovery input. */
export function toEquipmentRecoveryInput(
  source: EquipmentRecoverySource,
): EquipmentRecoveryInput {
  return {
    lastSeen: source.lastSeen,
    lastVerifiedAt: source.lastVerifiedAt,
    checkedOutAt: source.checkedOutAt,
    custodyState: source.custodyState,
    status: source.status,
  };
}

/** Derives a recovery snapshot from an equipment row (optional fixed `now` for tests). */
export function deriveEquipmentRecoverySnapshotFromSource(
  source: EquipmentRecoverySource,
  now?: Date,
): EquipmentRecoverySnapshot {
  return deriveEquipmentRecoverySnapshot(toEquipmentRecoveryInput(source), now);
}

/**
 * Stable numeric rank for attention sorting: higher = more urgent.
 *
 * Ordering (low → high urgency):
 * 1. `needsAttention === false` → 0 (sorts last)
 * 2. `needsAttention === true`:
 *    - `very_stale` confirm tier → 400
 *    - checked out too long (custody-gated in snapshot) → 300
 *    - stale confirm tier (not very_stale) → 200
 *    - recent confirm tier with attention (defensive) → 100
 *
 * Deterministic for a given snapshot; does not call `Date.now()`.
 */
export function recoveryAttentionRank(snapshot: EquipmentRecoverySnapshot): number {
  if (!snapshot.needsAttention) return 0;
  if (snapshot.stalenessLevel === "very_stale") return 400;
  if (snapshot.isCheckedOutTooLong) return 300;
  if (snapshot.isStale) return 200;
  return 100;
}

/** Comparator for `Array.sort`: more urgent snapshots sort earlier (higher rank first). */
export function compareRecoveryAttention(
  a: EquipmentRecoverySnapshot,
  b: EquipmentRecoverySnapshot,
): number {
  return recoveryAttentionRank(b) - recoveryAttentionRank(a);
}

/** Items whose recovery snapshot has `needsAttention === true`. */
export function filterEquipmentNeedingAttention<T extends EquipmentRecoverySource>(
  items: T[],
  now?: Date,
): T[] {
  return items.filter(
    (item) => deriveEquipmentRecoverySnapshotFromSource(item, now).needsAttention,
  );
}
