import { and, eq, sql } from "drizzle-orm";
import { db, equipment, stagingQueue } from "../db.js";
import { enqueueNotificationJob as _enqueueNotificationJob, type PushPriority } from "./queue.js";
import { getLocaleDictionaries } from "../../lib/i18n/loader.js";
import { interpolate, translate } from "../../lib/i18n/index.js";
import { resolveUserLocale as _resolveUserLocale } from "./resolve-user-locale.js";

async function _findNextClaim(equipmentId: string, clinicId: string) {
  return db
    .select({
      id: stagingQueue.id,
      requestedById: stagingQueue.requestedById,
      clinicalPriority: stagingQueue.clinicalPriority,
    })
    .from(stagingQueue)
    .where(
      and(
        eq(stagingQueue.equipmentId, equipmentId),
        eq(stagingQueue.clinicId, clinicId),
        eq(stagingQueue.status, "active"),
      ),
    )
    .orderBy(
      sql`CASE ${stagingQueue.clinicalPriority} WHEN 'emergency' THEN 3 WHEN 'urgent' THEN 2 WHEN 'routine' THEN 1 ELSE 0 END DESC`,
      stagingQueue.stagedAt,
    )
    .limit(1)
    .then((r) => r[0] ?? null);
}

async function _getEquipmentName(equipmentId: string, clinicId: string) {
  return db
    .select({ name: equipment.name })
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)))
    .limit(1)
    .then((r) => r[0]?.name ?? "");
}

// Dependency injection object — allows tests to swap individual helpers without
// mocking the Drizzle fluent chain (which would be fragile). Tests set e.g.
// stagingPromotionDeps.findNextClaim = vi.fn(...) then restore in afterEach.
export const stagingPromotionDeps = {
  findNextClaim: _findNextClaim,
  getEquipmentName: _getEquipmentName,
  resolveLocale: _resolveUserLocale,
  enqueueNotificationJob: _enqueueNotificationJob,
};

export async function promoteStagingQueueNext(
  equipmentId: string,
  clinicId: string,
): Promise<void> {
  try {
    const nextClaim = await stagingPromotionDeps.findNextClaim(equipmentId, clinicId);
    if (!nextClaim) return;

    const equipmentName = await stagingPromotionDeps.getEquipmentName(equipmentId, clinicId);

    const priority: PushPriority =
      nextClaim.clinicalPriority === "emergency" ? "CRITICAL"
      : nextClaim.clinicalPriority === "urgent" ? "HIGH"
      : "NORMAL";

    const locale = await stagingPromotionDeps.resolveLocale(clinicId, nextClaim.requestedById);
    const { primary, fallback, locale: lc } = getLocaleDictionaries(locale);
    const title = translate(primary, "stagingQueue.promotedTitle", undefined, { fallbackDict: fallback, locale: lc });
    const bodyTemplate = translate(primary, "stagingQueue.promotedBody", undefined, { fallbackDict: fallback, locale: lc });
    const body = interpolate(bodyTemplate, { name: equipmentName });

    await stagingPromotionDeps.enqueueNotificationJob({
      type: "push_to_user",
      clinicId,
      userId: nextClaim.requestedById,
      title,
      body,
      tag: `staging-promoted:${equipmentId}`,
      url: `/equipment/${equipmentId}`,
      priority,
      idempotencyKey: `staging-promoted:${nextClaim.id}`,
    });
  } catch (err) {
    console.error("[staging-promotion] failed:", err);
    // never throw — fire-and-forget
  }
}
