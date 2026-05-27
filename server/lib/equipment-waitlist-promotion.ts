import { and, eq } from "drizzle-orm";
import { db, equipment } from "../db.js";
import { enqueueNotificationJob as _enqueueNotificationJob, type PushPriority } from "./queue.js";
import {
  promoteEquipmentWaitlistIfEligible as _promoteEquipmentWaitlistIfEligible,
  type EquipmentWaitlistRow,
} from "../services/equipment-waitlist.service.js";
import { EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES } from "../../shared/equipment-waitlist.js";

export async function _getEquipmentName(equipmentId: string, clinicId: string) {
  return db
    .select({ name: equipment.name })
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)))
    .limit(1)
    .then((r) => r[0]?.name ?? "");
}

export const equipmentWaitlistPromotionDeps = {
  promoteIfEligible: _promoteEquipmentWaitlistIfEligible,
  getEquipmentName: _getEquipmentName,
  enqueueNotificationJob: _enqueueNotificationJob,
};

export async function notifyWaitlistPromoted(
  clinicId: string,
  equipmentId: string,
  promoted: EquipmentWaitlistRow,
): Promise<void> {
  try {
    const equipmentName = await equipmentWaitlistPromotionDeps.getEquipmentName(equipmentId, clinicId);
    const priority: PushPriority = "HIGH";

    await equipmentWaitlistPromotionDeps.enqueueNotificationJob({
      type: "push_to_user",
      clinicId,
      userId: promoted.userId,
      title: "Device available for you",
      body: `${equipmentName} is available — you have ${EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES} minutes to check out`,
      tag: `waitlist-promoted:${equipmentId}`,
      url: `/equipment/${equipmentId}`,
      priority,
      idempotencyKey: `waitlist-promoted:${promoted.id}`,
    });
  } catch (err) {
    console.error("[equipment-waitlist-promotion] notify failed:", err);
  }
}

export async function promoteEquipmentWaitlistWithNotify(
  clinicId: string,
  equipmentId: string,
  trigger: "return" | "dock_return" | "ttl_expiry",
): Promise<void> {
  try {
    const promoted = await equipmentWaitlistPromotionDeps.promoteIfEligible(
      clinicId,
      equipmentId,
      trigger,
    );
    if (promoted) {
      void notifyWaitlistPromoted(clinicId, equipmentId, promoted);
    }
  } catch (err) {
    console.error("[equipment-waitlist-promotion] promote failed:", err);
  }
}
