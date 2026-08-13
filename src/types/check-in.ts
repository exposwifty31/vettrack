/**
 * Clinical check-in client types (doctor shift gate, spec 2026-08-13).
 * Mirrors `serializeCheckIn` in server/routes/clinical-check-in.ts.
 */

import type { DoctorTeamRole } from "../../shared/doctor-teams.js";

export type { DoctorTeamRole };

export interface CheckInRow {
  id: string;
  clinicId: string;
  userId: string;
  operationalRole: string | null;
  isSenior: boolean;
  clinicalRoleAtCheckIn: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  checkOutReason: string | null;
}

/** Request body shared by POST /clinical-check-in/check-in and /switch. */
export interface CheckInRequest {
  operationalRole: DoctorTeamRole;
  isSenior?: boolean;
  replaceSenior?: boolean;
}

/** Response envelope of GET /api/clinical-check-in/me/active. */
export interface ActiveCheckInResponse {
  active: CheckInRow | null;
}

/** 409 reason code when another senior already holds the requested team. */
export const SENIOR_ALREADY_ASSIGNED = "SENIOR_ALREADY_ASSIGNED";

export interface SeniorConflict {
  currentSeniorName: string | null;
}

/**
 * Narrow a check-in/switch mutation error to the SENIOR_ALREADY_ASSIGNED
 * conflict (409 with `payload.details.currentSeniorName`). Returns null for
 * every other error.
 */
export function readSeniorConflict(err: unknown): SeniorConflict | null {
  if (typeof err !== "object" || err === null) return null;
  if ((err as { code?: unknown }).code !== SENIOR_ALREADY_ASSIGNED) return null;
  const payload = (err as { payload?: unknown }).payload;
  const details =
    typeof payload === "object" && payload !== null
      ? (payload as { details?: unknown }).details
      : undefined;
  const name =
    typeof details === "object" && details !== null
      ? (details as Record<string, unknown>).currentSeniorName
      : undefined;
  return { currentSeniorName: typeof name === "string" ? name : null };
}
