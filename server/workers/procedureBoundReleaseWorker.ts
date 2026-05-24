import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, equipment, hospitalizations } from "../db.js";
import {
  isOperationalStateFeatureEnabled,
  releaseProcedureBoundEquipment,
} from "../services/equipment-operational-state.service.js";

const RELEASE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;

export async function runProcedureBoundReleaseSweep(
  now: Date = new Date(),
): Promise<{ scanned: number; released: number }> {
  if (!isOperationalStateFeatureEnabled()) return { scanned: 0, released: 0 };

  // DISTINCT (clinicId, hospitalizationId) pairs via INNER JOIN to avoid N+1.
  // INNER JOIN vt_hospitalizations ensures we only touch discharged ones.
  const groups = await db
    .selectDistinct({
      clinicId: equipment.clinicId,
      hospitalizationId: equipment.procedureBoundHospitalizationId,
    })
    .from(equipment)
    .innerJoin(
      hospitalizations,
      and(
        eq(hospitalizations.id, equipment.procedureBoundHospitalizationId!),
        eq(hospitalizations.clinicId, equipment.clinicId),
      ),
    )
    .where(
      and(
        eq(equipment.usageState, "procedure_bound"),
        isNotNull(equipment.procedureBoundHospitalizationId),
        eq(hospitalizations.status, "discharged"),
      ),
    );

  let totalReleased = 0;
  for (const group of groups) {
    if (!group.hospitalizationId) continue;
    const { released } = await releaseProcedureBoundEquipment(
      group.clinicId,
      group.hospitalizationId,
      now,
    );
    totalReleased += released;
  }

  return { scanned: groups.length, released: totalReleased };
}

let _intervalId: ReturnType<typeof setInterval> | null = null;

export function startProcedureBoundReleaseWorker(): void {
  if (_intervalId !== null) return;
  if (!isOperationalStateFeatureEnabled()) return;

  _intervalId = setInterval(() => {
    runProcedureBoundReleaseSweep().catch((err) => {
      console.error("[procedure-bound-release-worker] sweep failed:", err);
    });
  }, RELEASE_SWEEP_INTERVAL_MS);

  runProcedureBoundReleaseSweep().catch((err) => {
    console.error("[procedure-bound-release-worker] startup sweep failed:", err);
  });
}
