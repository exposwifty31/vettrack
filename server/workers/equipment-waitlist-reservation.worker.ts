import { logAudit } from "../lib/audit.js";
import { promoteEquipmentWaitlistWithNotify } from "../lib/equipment-waitlist-promotion.js";
import { expireNotifiedReservations } from "../services/equipment-waitlist.service.js";

const SWEEP_INTERVAL_MS = 60 * 1000;

export async function runEquipmentWaitlistReservationSweep(
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const expiredRows = await expireNotifiedReservations(now);
  const seen = new Set<string>();
  for (const row of expiredRows) {
    const key = `${row.clinicId}:${row.equipmentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    logAudit({
      clinicId: row.clinicId,
      actionType: "equipment_waitlist_expired",
      performedBy: "system",
      performedByEmail: "system",
      targetId: row.equipmentId,
      metadata: { waitlistId: row.id, userId: row.userId },
    });
    void promoteEquipmentWaitlistWithNotify(row.clinicId, row.equipmentId, "ttl_expiry");
  }
  return { expired: expiredRows.length };
}

export function startEquipmentWaitlistReservationWorker(): void {
  if (process.env.NODE_ENV === "test") return;

  setInterval(() => {
    void runEquipmentWaitlistReservationSweep().catch((err) => {
      console.error("[equipment-waitlist-reservation] sweep failed:", err);
    });
  }, SWEEP_INTERVAL_MS);

  void runEquipmentWaitlistReservationSweep().catch(() => {});
}
