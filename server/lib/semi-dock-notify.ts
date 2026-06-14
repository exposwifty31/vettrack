import { randomUUID } from "crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { alertAcks, db } from "../db.js";
import { loadLocale } from "../../lib/i18n/loader.js";
import { resolve as resolveI18nKey } from "../../lib/i18n/index.js";
import { logAudit } from "./audit.js";
import { incrementMetric } from "./metrics.js";
import { sendPushToUser } from "./push.js";

const SEMI_DOCK_ALERT_TYPE = "semi_dock_return" as const;
const SYSTEM_USER_ID = "system:rfid";
const SYSTEM_USER_EMAIL = "rfid@vettrack.system";

export function buildSemiDockTag(equipmentId: string): string {
  return `semi-dock:${equipmentId}`;
}

/** Home = equipment's assigned room and/or its dock's room — not every dock room in the clinic. */
export function buildEquipmentHomeRoomIds(
  equipmentRoomId: string | null,
  equipmentDockRoomId: string | null,
): Set<string> {
  const ids = new Set<string>();
  if (equipmentRoomId) ids.add(equipmentRoomId);
  if (equipmentDockRoomId) ids.add(equipmentDockRoomId);
  return ids;
}

export function isEquipmentHomeRoom(newRoomId: string, homeRoomIds: ReadonlySet<string>): boolean {
  return homeRoomIds.has(newRoomId);
}

type DbLike = Pick<typeof db, "select" | "insert">;

async function wasSemiDockNotifiedSinceCheckout(
  clinicId: string,
  equipmentId: string,
  checkedOutAt: Date,
  conn: DbLike = db,
): Promise<boolean> {
  const [row] = await conn
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

async function markSemiDockNotified(
  clinicId: string,
  equipmentId: string,
  conn: DbLike = db,
): Promise<void> {
  await conn.insert(alertAcks).values({
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

function semiDockPushCopy(): { title: string; body: string } {
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

/**
 * Claims a semi-dock notify slot for this checkout under a per-equipment advisory
 * lock and runs `deliver` while the lock is held. The notify slot (alertAck row) is
 * persisted **only if `deliver` resolves** — if the push fails the transaction rolls
 * back, no ack is written, and the next RFID read can retry. The advisory lock
 * serializes concurrent deliveries for the same equipment so the push fires once.
 * Returns false (without running `deliver`) when a notify was already sent since checkout.
 */
async function claimSemiDockNotifySlot(
  clinicId: string,
  equipmentId: string,
  checkedOutAt: Date,
  deliver: () => Promise<void>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${equipmentId}))`);
    const already = await wasSemiDockNotifiedSinceCheckout(
      clinicId,
      equipmentId,
      checkedOutAt,
      tx,
    );
    if (already) return false;
    // Deliver first; a throw rolls back the transaction so the ack is never written
    // (retriable). Only mark notified once delivery has succeeded.
    await deliver();
    await markSemiDockNotified(clinicId, equipmentId, tx);
    return true;
  });
}

export async function deliverSemiDockPush(candidate: SemiDockNotifyCandidate): Promise<void> {
  const { title, body } = semiDockPushCopy();
  const tag = buildSemiDockTag(candidate.equipmentId);
  const url = `/equipment/${candidate.equipmentId}`;

  try {
    const claimed = await claimSemiDockNotifySlot(
      candidate.clinicId,
      candidate.equipmentId,
      candidate.checkedOutAt,
      async () => {
        await sendPushToUser(candidate.clinicId, candidate.checkedOutById, { title, body, tag, url });
      },
    );
    if (!claimed) {
      incrementMetric("semi_dock_skipped_deduped");
      return;
    }
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
    // Push failed inside the claim transaction → notify slot rolled back, retriable on next read.
    console.error("[semi-dock-notify] push failed; notify slot rolled back for retry", err);
  }
}
