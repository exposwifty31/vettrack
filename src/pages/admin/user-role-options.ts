import { t } from "@/lib/i18n";

export type AdminUserRole = "admin" | "vet" | "technician" | "senior_technician" | "student";
export type AdminUserStatus = "pending" | "active" | "blocked";

/**
 * Option vocabulary for the `/admin` users tab selects, shared by the
 * desktop `UsersTable` and the narrow `UsersMobileList`.
 */
export const ROLE_LABELS: Record<AdminUserRole, string> = {
  admin: t.adminPage.roleAdmin,
  vet: t.adminPage.roleVet,
  technician: t.adminPage.roleTechnician,
  senior_technician: t.adminPage.roleSeniorTechnician,
  student: t.adminPage.roleStudent,
};

export const ROLE_OPTIONS: ReadonlyArray<{ value: AdminUserRole; label: string }> = [
  { value: "admin", label: ROLE_LABELS.admin },
  { value: "vet", label: ROLE_LABELS.vet },
  { value: "technician", label: ROLE_LABELS.technician },
  { value: "senior_technician", label: ROLE_LABELS.senior_technician },
  { value: "student", label: ROLE_LABELS.student },
];

/** `none` is the sentinel the select uses for "no secondary role" (mapped to null on change). */
export const SECONDARY_ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "none", label: t.adminPage.secondaryRoleNone },
  { value: "admin", label: t.adminPage.roleAdmin },
  { value: "senior_technician", label: t.adminPage.roleSeniorTechnician },
  { value: "technician", label: t.adminPage.roleTechnician },
];

export const STATUS_OPTIONS: ReadonlyArray<{ value: AdminUserStatus; label: string }> = [
  { value: "pending", label: t.adminPage.filterPending },
  { value: "active", label: t.adminPage.filterActive },
  { value: "blocked", label: t.adminPage.filterBlocked },
];
