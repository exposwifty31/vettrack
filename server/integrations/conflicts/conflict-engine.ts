/**
 * Patient inbound merge policies — Phase B Sprint 2 (patients only).
 * Default mirrors legacy worker behavior: external snapshot wins when fields differ.
 */

import type { ExternalPatient } from "../types.js";

export type ConflictPolicy =
  | "vettrack_wins"
  | "external_wins"
  | "manual_required"
  | "newest_timestamp_wins";

export type PatientResolutionKind = "apply_external" | "keep_local" | "manual_conflict";

export interface PatientResolution {
  kind: PatientResolutionKind;
  /** Present when kind === manual_conflict — no PHI (field keys + timestamps only). */
  snapshot?: PatientConflictPayloadSnapshot;
}

/** Stored in vt_integration_sync_conflicts.payload_snapshot — no PHI. */
export interface PatientConflictPayloadSnapshot {
  entityType: "patient";
  policyUsed: ConflictPolicy;
  diffFields: string[];
  localUpdatedAtIso: string | null;
  externalUpdatedAtIso: string | null;
}

export interface LocalPatientRow {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  sex: string | null;
  color: string | null;
  recordNumber: string | null;
  updatedAt: Date;
}

function norm(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/** Which scalar fields differ between VetTrack row and inbound payload (labels only — no values in snapshot beyond policy). */
export function diffPatientFieldKeys(local: LocalPatientRow, incoming: ExternalPatient): string[] {
  const keys: string[] = [];
  if (norm(local.name) !== norm(incoming.name)) keys.push("name");
  if (norm(local.species) !== norm(incoming.species)) keys.push("species");
  if (norm(local.breed) !== norm(incoming.breed)) keys.push("breed");
  if (norm(local.sex) !== norm(incoming.sex)) keys.push("sex");
  if (norm(local.color) !== norm(incoming.color)) keys.push("color");
  if (norm(local.recordNumber) !== norm(incoming.recordNumber)) keys.push("recordNumber");
  return keys;
}

export function patientRowsDiffer(local: LocalPatientRow, incoming: ExternalPatient): boolean {
  return diffPatientFieldKeys(local, incoming).length > 0;
}

export function extractPatientConflictPolicy(metadata: unknown): ConflictPolicy {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const cp = m.conflictPolicy && typeof m.conflictPolicy === "object" ? (m.conflictPolicy as Record<string, unknown>) : {};
  const p = cp.patients;
  if (
    p === "vettrack_wins" ||
    p === "external_wins" ||
    p === "manual_required" ||
    p === "newest_timestamp_wins"
  ) {
    return p;
  }
  // Default: internal system is authoritative — all unresolved conflicts require manual review.
  return "manual_required";
}

export function resolvePatientInboundConflict(
  policy: ConflictPolicy,
  local: LocalPatientRow,
  incoming: ExternalPatient,
): PatientResolution {
  if (!patientRowsDiffer(local, incoming)) {
    return { kind: "apply_external" };
  }

  const diffFields = diffPatientFieldKeys(local, incoming);
  const baseSnapshot: PatientConflictPayloadSnapshot = {
    entityType: "patient",
    policyUsed: policy,
    diffFields,
    localUpdatedAtIso: local.updatedAt.toISOString(),
    externalUpdatedAtIso: incoming.externalUpdatedAt?.trim()
      ? new Date(incoming.externalUpdatedAt).toISOString()
      : null,
  };

  switch (policy) {
    case "external_wins":
      return { kind: "apply_external" };
    case "vettrack_wins":
      return { kind: "keep_local" };
    case "manual_required":
      return { kind: "manual_conflict", snapshot: baseSnapshot };
    case "newest_timestamp_wins": {
      const extIso = incoming.externalUpdatedAt?.trim();
      const extMs = extIso ? Date.parse(extIso) : NaN;
      if (!Number.isFinite(extMs)) {
        return { kind: "apply_external" };
      }
      if (extMs > local.updatedAt.getTime()) {
        return { kind: "apply_external" };
      }
      return { kind: "keep_local" };
    }
  }
}
