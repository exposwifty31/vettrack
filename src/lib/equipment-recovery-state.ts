/**
 * Equipment Recovery Layer — per-equipment snapshot derivation (pure client).
 * Threshold math lives in equipment-recovery-thresholds.ts only.
 */

import type { CustodyState, EquipmentStatus } from "@/types";
import {
  getEquipmentStalenessLevel,
  isCheckedOutTooLong,
  isEquipmentStale,
  type EquipmentStalenessLevel,
} from "./equipment-recovery-thresholds";

export type EquipmentConfirmSource = "last_seen" | "last_verified" | "none";

/** Minimal equipment fields for recovery derivation (no user/debt fields). */
export interface EquipmentRecoveryInput {
  lastSeen?: string | Date | null;
  lastVerifiedAt?: string | Date | null;
  checkedOutAt?: string | Date | null;
  custodyState?: CustodyState | null;
  status?: EquipmentStatus | string | null;
}

export interface EquipmentRecoverySnapshot {
  stalenessLevel: EquipmentStalenessLevel;
  isStale: boolean;
  isCheckedOutTooLong: boolean;
  confirmSource: EquipmentConfirmSource;
  confirmAt: string | null;
  needsAttention: boolean;
}

function toEpochMs(timestamp: string | Date | null | undefined): number | null {
  if (timestamp == null) return null;
  const instant = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const ms = instant.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Which confirm timestamp drives staleness (newer of last seen vs last verified). */
export function resolveEquipmentConfirm(
  input: Pick<EquipmentRecoveryInput, "lastSeen" | "lastVerifiedAt">,
): { source: EquipmentConfirmSource; at: Date | null } {
  const seenMs = toEpochMs(input.lastSeen);
  const verifiedMs = toEpochMs(input.lastVerifiedAt);

  if (seenMs == null && verifiedMs == null) {
    return { source: "none", at: null };
  }
  if (seenMs == null) {
    return { source: "last_verified", at: new Date(verifiedMs!) };
  }
  if (verifiedMs == null) {
    return { source: "last_seen", at: new Date(seenMs) };
  }
  if (verifiedMs >= seenMs) {
    return { source: "last_verified", at: new Date(verifiedMs) };
  }
  return { source: "last_seen", at: new Date(seenMs) };
}

/** True when custody (or legacy checkout timestamp) indicates an active checkout. */
export function isCheckedOutForRecovery(input: EquipmentRecoveryInput): boolean {
  const { custodyState, checkedOutAt } = input;
  if (custodyState === "checked_out") return true;
  if (
    custodyState === "docked" ||
    custodyState === "returned" ||
    custodyState === "untracked"
  ) {
    return false;
  }
  return checkedOutAt != null;
}

/**
 * Equipment-level recovery snapshot for a single item.
 * Checkout-too-long applies only when {@link isCheckedOutForRecovery} is true.
 */
export function deriveEquipmentRecoverySnapshot(
  input: EquipmentRecoveryInput,
  now: Date = new Date(),
): EquipmentRecoverySnapshot {
  const { source, at } = resolveEquipmentConfirm(input);
  const stalenessLevel = getEquipmentStalenessLevel(at, now);
  const isStale = isEquipmentStale(at, now);
  const checkedOutGated = isCheckedOutForRecovery(input);
  const isCheckedOutTooLongFlag =
    checkedOutGated && isCheckedOutTooLong(input.checkedOutAt, now);
  const needsAttention = isStale || isCheckedOutTooLongFlag;

  return {
    stalenessLevel,
    isStale,
    isCheckedOutTooLong: isCheckedOutTooLongFlag,
    confirmSource: source,
    confirmAt: at?.toISOString() ?? null,
    needsAttention,
  };
}
