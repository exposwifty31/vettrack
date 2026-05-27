import type { Equipment } from "@/types";
import type { EquipmentWaitlistSnapshot, EquipmentWaitlistStatus } from "../../shared/equipment-waitlist";

export function isReservationExpired(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= nowMs;
}

export function shouldShowReservationBanner(
  myStatus: EquipmentWaitlistStatus | null | undefined,
  reservationExpiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return myStatus === "notified" && !isReservationExpired(reservationExpiresAt, nowMs);
}

export function shouldShowWaitlistJoinPanel(
  equipment: Pick<Equipment, "custodyState" | "checkedOutById">,
  currentUserId: string,
): boolean {
  return (
    equipment.custodyState === "checked_out" &&
    !!equipment.checkedOutById &&
    equipment.checkedOutById !== currentUserId
  );
}

export type HolderReturnEstimate = {
  hasEstimate: boolean;
  expectedReturnAt: Date | null;
  isOverdue: boolean;
};

export function computeHolderReturnEstimate(
  equipment: Pick<Equipment, "checkedOutAt" | "expectedReturnMinutes" | "custodyState">,
  nowMs: number = Date.now(),
): HolderReturnEstimate {
  const minutes = equipment.expectedReturnMinutes;
  const checkedOutAt = equipment.checkedOutAt;
  if (minutes == null || minutes <= 0 || !checkedOutAt) {
    return { hasEstimate: false, expectedReturnAt: null, isOverdue: false };
  }
  const checkoutMs = new Date(checkedOutAt).getTime();
  if (Number.isNaN(checkoutMs)) {
    return { hasEstimate: false, expectedReturnAt: null, isOverdue: false };
  }
  const expectedReturnAt = new Date(checkoutMs + minutes * 60_000);
  const isOverdue =
    equipment.custodyState === "checked_out" && nowMs >= expectedReturnAt.getTime();
  return { hasEstimate: true, expectedReturnAt, isOverdue };
}

/** Pre-promotion waiter context — hidden when reservation banner is active (WTL-UX-02a). */
export function shouldShowHolderReturnContext(
  equipment: Pick<Equipment, "custodyState" | "checkedOutById">,
  currentUserId: string,
  showReservationBanner: boolean,
): boolean {
  if (showReservationBanner) return false;
  return shouldShowWaitlistJoinPanel(equipment, currentUserId);
}

export function reservationMinutesRemaining(
  expiresAt: string,
  nowMs: number = Date.now(),
): number {
  const ms = new Date(expiresAt).getTime() - nowMs;
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 60_000));
}

export function formatReservationCountdown(expiresAt: string, nowMs: number = Date.now()): string {
  const ms = new Date(expiresAt).getTime() - nowMs;
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export type { EquipmentWaitlistSnapshot };
