import { t } from "@/lib/i18n";
import type { DoctorTeamRole } from "@/types/check-in";

export const TEAM_ROLES: readonly DoctorTeamRole[] = [
  "icu",
  "admission",
  "internal_medicine",
];

export function isDoctorTeamRole(v: string | null | undefined): v is DoctorTeamRole {
  return v === "icu" || v === "admission" || v === "internal_medicine";
}

export function teamLabel(team: DoctorTeamRole): string {
  switch (team) {
    case "icu":
      return t.doctorGate.teamIcu;
    case "admission":
      return t.doctorGate.teamAdmission;
    case "internal_medicine":
      return t.doctorGate.teamInternalMedicine;
  }
}
