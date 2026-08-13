import { t } from "@/lib/i18n";
import {
  DOCTOR_TEAM_ROLES,
  isDoctorTeamRole as isDoctorTeamRoleShared,
} from "../../../shared/doctor-teams";
import type { DoctorTeamRole } from "@/types/check-in";

export const TEAM_ROLES: readonly DoctorTeamRole[] = DOCTOR_TEAM_ROLES;

export function isDoctorTeamRole(v: string | null | undefined): v is DoctorTeamRole {
  return typeof v === "string" && isDoctorTeamRoleShared(v);
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
