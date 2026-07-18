/**
 * R-SH-F1.5 — client-side shift-handover artifact types (the `/handoff` read +
 * acknowledge / unconfirm responses). Mirrors the server wire shape
 * (`server/services/shift-handover.service.ts#SerializedHandoverArtifact`);
 * timestamps are ISO strings. The `patientWorklist` is the same PMS-agnostic
 * discriminated union — a PMS failure surfaces as `{ state: 'error', code }`,
 * never a silent empty `ready` list. External PMS ids only (`externalId` /
 * `display`); `byTechId` is the internal VetTrack user id (also surfaced,
 * name-resolved, in `staff`).
 */

export interface ShiftHandoverDeltaEntry {
  sourceId: string;
  kind: string;
  targetId: string | null;
  targetType: string | null;
  at: string;
}

export interface ShiftHandoverDeltas {
  custody: ShiftHandoverDeltaEntry[];
  taskState: ShiftHandoverDeltaEntry[];
  alerts: ShiftHandoverDeltaEntry[];
  dispenses: ShiftHandoverDeltaEntry[];
}

export interface ShiftHandoverOpenItem {
  id: string;
  kind: string;
  summary: string;
}

export interface ShiftHandoverObservedSignal {
  sourceId: string;
  kind: string;
  at: string;
}

export type PatientWorklistErrorCode = "unreachable" | "auth_failed" | "timeout" | "malformed" | "unknown";

export type PatientWorklist =
  | { state: "not_configured" }
  | { state: "ready"; entries: Array<{ externalId: string; display: string; byTechId: string }> }
  | { state: "error"; code: PatientWorklistErrorCode };

export interface ShiftHandoverStaff {
  userId: string;
  name: string;
}

export interface ShiftHandoverArtifact {
  id: string;
  shiftSessionId: string;
  revision: number;
  deltas: ShiftHandoverDeltas;
  openItems: ShiftHandoverOpenItem[];
  observedSignals: ShiftHandoverObservedSignal[];
  patientWorklist: PatientWorklist;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  notificationReadAt: string | null;
  generatedAt: string;
  staff: ShiftHandoverStaff[];
}

export interface ShiftHandoverResponse {
  handover: ShiftHandoverArtifact | null;
}
