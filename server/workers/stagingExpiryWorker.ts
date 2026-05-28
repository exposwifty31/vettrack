import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, equipment, stagingQueue } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";
import { promoteStagingQueueNext } from "../lib/staging-promotion.js";

const EXPIRY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export function resolveEmergencyStagingTtlHours(): number {
  const parsed = Number.parseInt(process.env.EMERGENCY_STAGING_TTL_HOURS ?? "8", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
}

export async function runStagingExpirySweep(now: Date = new Date()): Promise<{ expiredClaims: number; releasedEquipment: number }> {
  const expiredRows: Array<{
    id: string;
    clinicId: string;
    equipmentId: string;
  }> = [];

  // Expire all active claims whose expires_at < now.
  // RETURNING avoids a separate SELECT and prevents race where a claim is fulfilled mid-sweep.
  const timedExpiryRows = await db
    .update(stagingQueue)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(stagingQueue.status, "active"),
        isNotNull(stagingQueue.expiresAt),
        lt(stagingQueue.expiresAt, now),
      ),
    )
    .returning({
      id: stagingQueue.id,
      clinicId: stagingQueue.clinicId,
      equipmentId: stagingQueue.equipmentId,
    });

  expiredRows.push(...timedExpiryRows);

  const emergencyCutoff = new Date(now.getTime() - resolveEmergencyStagingTtlHours() * 60 * 60 * 1000);
  const emergencyExpiredRows = await db
    .update(stagingQueue)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(stagingQueue.status, "active"),
        isNull(stagingQueue.expiresAt),
        lt(stagingQueue.stagedAt, emergencyCutoff),
      ),
    )
    .returning({
      id: stagingQueue.id,
      clinicId: stagingQueue.clinicId,
      equipmentId: stagingQueue.equipmentId,
    });

  expiredRows.push(...emergencyExpiredRows);

  for (const row of timedExpiryRows) {
    logAudit({
      clinicId: row.clinicId,
      actionType: "equipment_stage_expired",
      performedBy: "system",
      performedByEmail: "system",
      targetId: row.equipmentId,
      metadata: { claimId: row.id },
    });
    void recordOperationalMetric({ clinicId: row.clinicId, equipmentId: row.equipmentId, eventType: "staging_expired" });
  }

  for (const row of emergencyExpiredRows) {
    logAudit({
      clinicId: row.clinicId,
      actionType: "equipment_emergency_staging_expired",
      performedBy: "system",
      performedByEmail: "system",
      targetId: row.equipmentId,
      metadata: { claimId: row.id, ttlHours: resolveEmergencyStagingTtlHours() },
    });
    void recordOperationalMetric({ clinicId: row.clinicId, equipmentId: row.equipmentId, eventType: "staging_expired" });
  }

  // For each unique equipment_id, release staged → available if no active claims remain.
  // Group by equipmentId+clinicId so all queries stay within tenant boundaries.
  const uniqueEquipmentIds = [...new Set(expiredRows.map((r) => r.equipmentId))];
  let releasedEquipment = 0;

  for (const equipmentId of uniqueEquipmentIds) {
    const clinicId = expiredRows.find((r) => r.equipmentId === equipmentId)?.clinicId;
    if (!clinicId) continue;

    // Check for remaining active claims — scoped to this clinic
    const remaining = await db
      .select({ id: stagingQueue.id })
      .from(stagingQueue)
      .where(
        and(
          eq(stagingQueue.equipmentId, equipmentId),
          eq(stagingQueue.clinicId, clinicId),
          eq(stagingQueue.status, "active"),
        ),
      );

    if (remaining.length > 0) {
      void promoteStagingQueueNext(equipmentId, clinicId);
      continue;
    }

    // Fetch current equipment row for version guard — scoped to this clinic
    const rows = await db
      .select()
      .from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId)))
      .limit(1);
    const eq_row = rows[0];
    if (!eq_row) continue;

    // Version-guarded update — WHERE usageState='staged' AND clinicId prevents cross-tenant stomps
    const updateResult = await db
      .update(equipment)
      .set({
        usageState: "available",
        usageStateSince: now,
        version: sql`${equipment.version} + 1`,
      })
      .where(
        and(
          eq(equipment.id, equipmentId),
          eq(equipment.clinicId, clinicId),
          eq(equipment.usageState, "staged"),
          eq(equipment.version, eq_row.version),
        ),
      );

    if ((updateResult as unknown as { rowCount?: number }).rowCount === 0) {
      // Concurrent change (e.g., equipment checked out) — skip
      continue;
    }

    releasedEquipment++;

    void db.transaction(async (tx) => {
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "EQUIPMENT_USAGE_STATE_CHANGED",
        payload: { equipmentId, usageState: "available", reason: "staging_expired" },
      });
    }).catch((err) => {
      console.error("[staging-expiry-worker] realtime event failed (non-fatal):", err);
    });

    logAudit({
      clinicId,
      actionType: "equipment_usage_state_changed",
      performedBy: "system",
      performedByEmail: "system",
      targetId: equipmentId,
      metadata: { usageState: "available", reason: "staging_expired" },
    });
  }

  return { expiredClaims: expiredRows.length, releasedEquipment };
}

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startStagingExpiryWorker(): void {
  if (_intervalId !== null) return;
  _intervalId = setInterval(() => {
    runStagingExpirySweep().catch((err) => {
      console.error("[staging-expiry-worker] sweep failed:", err);
    });
  }, EXPIRY_SWEEP_INTERVAL_MS);

  runStagingExpirySweep().catch((err) => {
    console.error("[staging-expiry-worker] startup sweep failed:", err);
  });
}
