/**
 * Clinical check-in client types (doctor shift gate, spec 2026-08-13).
 * Mirrors `serializeCheckIn` in server/routes/clinical-check-in.ts.
 */

export type DoctorTeamRole = "icu" | "admission" | "internal_medicine";

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
