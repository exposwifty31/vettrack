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
