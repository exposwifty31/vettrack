export type EquipmentWaitlistStatus =
  | "waiting"
  | "notified"
  | "fulfilled"
  | "cancelled"
  | "expired";

export type EquipmentWaitlistEntry = {
  position: number;
  userId: string;
  displayName: string;
  status: "waiting" | "notified";
  joinedAt: string;
  reservationExpiresAt: string | null;
};

export type EquipmentWaitlistSnapshot = {
  equipmentId: string;
  queueSize: number;
  myPosition: number | null;
  myStatus: EquipmentWaitlistStatus | null;
  reservationExpiresAt: string | null;
  notifiedUserId: string | null;
  entries: EquipmentWaitlistEntry[];
};

export const EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES = 10;
