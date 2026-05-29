import { randomUUID } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { alertAcks, db } from "../db.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { resolve as resolveI18nKey } from "../../lib/i18n/index.js";
import { logAudit } from "./audit.js";
import { incrementMetric } from "./metrics.js";
import { sendPushToUser } from "./push.js";

export const SEMI_DOCK_ALERT_TYPE = "semi_dock_return" as const;
const SYSTEM_USER_ID = "system:rfid";
const SYSTEM_USER_EMAIL = "rfid@vettrack.system";

export function buildSemiDockTag(equipmentId: string): string {
  return `semi-dock:${equipmentId}`;
}

export function isEquipmentHomeRoom(
  equipmentRoomId: string | null,
  newRoomId: string,
  dockRoomIds: ReadonlySet<string>,
): boolean {
  if (equipmentRoomId && newRoomId === equipmentRoomId) return true;
  return dockRoomIds.has(newRoomId);
}

export async function wasSemiDockNotifiedSinceCheckout(
  clinicId: string,
  equipmentId: string,
  checkedOutAt: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: alertAcks.id })
    .from(alertAcks)
    .where(
      and(
        eq(alertAcks.clinicId, clinicId),
        eq(alertAcks.equipmentId, equipmentId),
        eq(alertAcks.alertType, SEMI_DOCK_ALERT_TYPE),
        gt(alertAcks.acknowledgedAt, checkedOutAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function markSemiDockNotified(clinicId: string, equipmentId: string): Promise<void> {
  await db.insert(alertAcks).values({
    id: randomUUID(),
    clinicId,
    equipmentId,
    alertType: SEMI_DOCK_ALERT_TYPE,
    acknowledgedById: SYSTEM_USER_ID,
    acknowledgedByEmail: SYSTEM_USER_EMAIL,
    acknowledgedAt: new Date(),
    ackStatus: "SEEN",
  });
}

export function semiDockPushCopy(): { title: string; body: string } {
  const dict = loadLocale("he");
  const title = resolveI18nKey(dict, "semiDock.pushTitle") ?? "Equipment returned to home room";
  const body = resolveI18nKey(dict, "semiDock.pushBody") ?? "If you finished using the device, return it to the charging station.";
  return { title, body };
}

export interface SemiDockNotifyCandidate {
  clinicId: string;
  equipmentId: string;
  equipmentName: string;
  checkedOutById: string;
  checkedOutAt: Date;
  homeRoomId: string;
}

export async function deliverSemiDockPush(candidate: SemiDockNotifyCandidate): Promise<void> {
  const already = await wasSemiDockNotifiedSinceCheckout(
    candidate.clinicId,
    candidate.equipmentId,
    candidate.checkedOutAt,
  );
  if (already) {
    incrementMetric("semi_dock_skipped_deduped");
    return;
  }

  const { title, body } = semiDockPushCopy();
  const tag = buildSemiDockTag(candidate.equipmentId);
  const url = `/equipment/${candidate.equipmentId}`;

  try {
    await sendPushToUser(candidate.clinicId, candidate.checkedOutById, { title, body, tag, url });
    await markSemiDockNotified(candidate.clinicId, candidate.equipmentId);
    incrementMetric("semi_dock_notified");
    logAudit({
      clinicId: candidate.clinicId,
      actionType: "equipment_semi_dock_notified",
      performedBy: SYSTEM_USER_ID,
      performedByEmail: SYSTEM_USER_EMAIL,
      targetId: candidate.equipmentId,
      targetType: "equipment",
      metadata: {
        homeRoomId: candidate.homeRoomId,
        checkedOutById: candidate.checkedOutById,
        equipmentName: candidate.equipmentName,
      },
    });
  } catch (err) {
    console.error("[semi-dock-notify] push failed", err);
  }
}
