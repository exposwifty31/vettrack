/**
 * Readiness tier-bucket helper (T-23b · R-EQ-F2).
 *
 * Pure map from the six EquipmentStatus tokens to a 3-tier readiness bucket.
 * Pinned mapping:
 *   ready     <- ok, sterilized
 *   caution   <- maintenance, needs_attention
 *   not_ready <- critical, issue
 */
import type { EquipmentStatus } from "@/types/equipment";

export type ReadinessTier = "ready" | "caution" | "not_ready";

const READINESS_TIER_BY_STATUS = {
  ok: "ready",
  sterilized: "ready",
  maintenance: "caution",
  needs_attention: "caution",
  critical: "not_ready",
  issue: "not_ready",
} satisfies Record<EquipmentStatus, ReadinessTier>;

export function getReadinessTier(status: EquipmentStatus): ReadinessTier {
  return READINESS_TIER_BY_STATUS[status];
}
