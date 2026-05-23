import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, equipment, assetTypeConditions, unitConditionStates } from "../db.js";
import { logAudit } from "../lib/audit.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import {
  computeBundleReadinessGate,
} from "../services/equipment-operational-state.service.js";
import { recordOperationalMetric } from "../services/operational-metrics.service.js";

const STALENESS_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function runEquipmentConditionStalenessSweep(now: Date = new Date()): Promise<{ scanned: number; markedNotReady: number }> {
  // Scan only docked+ready equipment that has an asset type
  const candidates = await db
    .select()
    .from(equipment)
    .where(
      and(
        eq(equipment.custodyState, "docked"),
        eq(equipment.readinessState, "ready"),
        isNotNull(equipment.assetTypeId),
        isNotNull(equipment.clinicId),
      ),
    );

  let markedNotReady = 0;

  for (const eq_row of candidates) {
    const conditions = await db
      .select()
      .from(assetTypeConditions)
      .where(eq(assetTypeConditions.assetTypeId, eq_row.assetTypeId!));

    const condStates = await db
      .select()
      .from(unitConditionStates)
      .where(eq(unitConditionStates.equipmentId, eq_row.id));

    const result = computeBundleReadinessGate(eq_row, condStates, conditions, now, true);

    if (!("skipped" in result) && !result.ok) {
      // Version-guarded UPDATE — guard on custody_state prevents overwriting equipment checked out between scan and update
      const updateResult = await db
        .update(equipment)
        .set({
          readinessState: "not_ready",
          readinessStateSince: now,
          version: sql`${equipment.version} + 1`,
        })
        .where(
          and(
            eq(equipment.id, eq_row.id),
            eq(equipment.clinicId, eq_row.clinicId),
            eq(equipment.custodyState, "docked"),
            eq(equipment.readinessState, "ready"),
            eq(equipment.version, eq_row.version),
          ),
        );

      if ((updateResult as unknown as { rowCount?: number }).rowCount === 0) {
        // Equipment state changed concurrently — skip
        continue;
      }

      markedNotReady++;
      void recordOperationalMetric({ clinicId: eq_row.clinicId, equipmentId: eq_row.id, eventType: "condition_stale" });

      void db.transaction(async (tx) => {
        await insertRealtimeDomainEvent(tx, {
          clinicId: eq_row.clinicId,
          type: "EQUIPMENT_READINESS_STATE_CHANGED",
          payload: { equipmentId: eq_row.id, readinessState: "not_ready", reason: "condition_stale" },
        });
      }).catch((err) => {
        console.error("[staleness-worker] realtime event failed (non-fatal):", err);
      });

      logAudit({
        clinicId: eq_row.clinicId,
        actionType: "equipment_readiness_state_changed",
        performedBy: "system",
        performedByEmail: "system",
        targetId: eq_row.id,
        metadata: { readinessState: "not_ready", reason: "condition_stale" },
      });
    }
  }

  return { scanned: candidates.length, markedNotReady };
}

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startEquipmentConditionStalenessWorker(): void {
  if (_intervalId !== null) return;
  _intervalId = setInterval(() => {
    runEquipmentConditionStalenessSweep().catch((err) => {
      console.error("[staleness-worker] sweep failed:", err);
    });
  }, STALENESS_SWEEP_INTERVAL_MS);

  // Run once at startup
  runEquipmentConditionStalenessSweep().catch((err) => {
    console.error("[staleness-worker] startup sweep failed:", err);
  });
}
