/**
 * Persistence for vt_integration_sync_conflicts — Phase B Sprint 2.
 */

import { eq, and, sql } from "drizzle-orm";
import { db, integrationSyncConflicts } from "../../db.js";
import type { ConflictPolicy, PatientConflictPayloadSnapshot } from "./conflict-engine.js";

export type ConflictSeverity = "LOW" | "HIGH";
export type ConflictResolution = "auto_external_wins" | "auto_vettrack_wins" | "pending_manual";

export async function insertPatientConflict(params: {
  id: string;
  clinicId: string;
  adapterId: string;
  localId: string;
  externalId: string;
  policyUsed: ConflictPolicy;
  payloadSnapshot: PatientConflictPayloadSnapshot;
  /** HIGH = requires manual review; LOW = auto-resolved (still logged for visibility). */
  severity: ConflictSeverity;
  /** How the conflict was (or will be) resolved. */
  resolution: ConflictResolution;
}): Promise<void> {
  const status = params.severity === "HIGH" ? "open" : "auto_resolved";
  await db.insert(integrationSyncConflicts).values({
    id: params.id,
    clinicId: params.clinicId,
    adapterId: params.adapterId,
    entityType: "patient",
    localId: params.localId,
    externalId: params.externalId,
    status,
    policyUsed: params.policyUsed,
    payloadSnapshot: params.payloadSnapshot,
    severity: params.severity,
    resolution: params.resolution,
  }).onConflictDoNothing();
  const { invalidateIntegrationDashboardCache } = await import("../dashboard/dashboard-cache.js");
  void invalidateIntegrationDashboardCache(params.clinicId).catch(() => {});
}

/** @deprecated Use insertPatientConflict */
export async function insertOpenPatientConflict(params: {
  id: string;
  clinicId: string;
  adapterId: string;
  localId: string;
  externalId: string;
  policyUsed: ConflictPolicy;
  payloadSnapshot: PatientConflictPayloadSnapshot;
}): Promise<void> {
  return insertPatientConflict({ ...params, severity: "HIGH", resolution: "pending_manual" });
}

export async function countOpenConflictsForClinic(clinicId: string): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(integrationSyncConflicts)
    .where(and(eq(integrationSyncConflicts.clinicId, clinicId), eq(integrationSyncConflicts.status, "open")))
    .then((r) => r[0]);
  return row?.n ?? 0;
}
