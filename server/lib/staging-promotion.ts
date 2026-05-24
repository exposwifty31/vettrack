import { and, eq, sql } from "drizzle-orm";
import { db, equipment, stagingQueue } from "../db.js";
import { enqueueNotificationJob as _enqueueNotificationJob, type PushPriority } from "./queue.js";

export async function _findNextClaim(equipmentId: string, clinicId: string) {
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

export async function _getEquipmentName(equipmentId: string, clinicId: string) {
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

    // TODO: i18n — push notification locale hardcoded as Hebrew (no req.locale in fire-and-forget context)
    const priority: PushPriority =
      nextClaim.clinicalPriority === "emergency" ? "CRITICAL"
      : nextClaim.clinicalPriority === "urgent" ? "HIGH"
      : "NORMAL";

    await stagingPromotionDeps.enqueueNotificationJob({
      type: "push_to_user",
      clinicId,
      userId: nextClaim.requestedById,
      title: "אתה ראשון בתור",
      body: `ניתן לבצע checkout של ${equipmentName}`,
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
