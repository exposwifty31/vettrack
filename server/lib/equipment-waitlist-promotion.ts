import { and, eq } from "drizzle-orm";
import { db, equipment, users } from "../db.js";
import { enqueueNotificationJob as _enqueueNotificationJob, type PushPriority } from "./queue.js";
import { promoteEquipmentWaitlistIfEligible as _promoteEquipmentWaitlistIfEligible } from "../services/equipment-waitlist.service.js";
import type { EquipmentWaitlistRow } from "../db.js";
import { EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES } from "../../shared/equipment-waitlist.js";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { interpolate, translate } from "../../lib/i18n/index.js";
import type { Locale } from "../../lib/i18n/types.js";

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

async function resolveUserLocale(clinicId: string, userId: string): Promise<Locale> {
  const [row] = await db
    .select({ preferredLocale: users.preferredLocale })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
    .limit(1);
  const loc = row?.preferredLocale;
  return loc === "en" || loc === "he" ? loc : "he";
}

export async function notifyWaitlistPromoted(
  clinicId: string,
  equipmentId: string,
  promoted: EquipmentWaitlistRow,
): Promise<void> {
  try {
    const equipmentName = await equipmentWaitlistPromotionDeps.getEquipmentName(equipmentId, clinicId);
    const locale = await resolveUserLocale(clinicId, promoted.userId);
    const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
    const priority: PushPriority = "HIGH";
    const title = translate(primary, "equipmentWaitlist.promotedTitle", undefined, {
      fallbackDict: fallback,
      locale: lc,
    });
    const bodyTemplate = translate(primary, "equipmentWaitlist.promotedBody", undefined, {
      fallbackDict: fallback,
      locale: lc,
    });
    const body = interpolate(bodyTemplate, {
      name: equipmentName,
      minutes: EQUIPMENT_WAITLIST_RESERVATION_TTL_MINUTES,
    });

    await equipmentWaitlistPromotionDeps.enqueueNotificationJob({
      type: "push_to_user",
      clinicId,
      userId: promoted.userId,
      title,
      body,
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
