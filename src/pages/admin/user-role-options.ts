import { t } from "@/lib/i18n";

export type AdminUserRole = "admin" | "vet" | "technician" | "senior_technician" | "student";
export type AdminUserStatus = "pending" | "active" | "blocked";

/**
 * Option vocabulary for the `/admin` users tab selects.
 *
 * Extracted for the desktop `UsersTable`. The card row in `UsersSection.tsx` still
 * inlines the same `<SelectItem>` lists; pointing it here too is a follow-up, kept
 * out of this change to hold the diff to the desktop branch.
 */
export const ROLE_OPTIONS: ReadonlyArray<{ value: AdminUserRole; label: string }> = [
  { value: "admin", label: t.adminPage.roleAdmin },
  { value: "vet", label: t.adminPage.roleVet },
  { value: "technician", label: t.adminPage.roleTechnician },
  { value: "senior_technician", label: t.adminPage.roleSeniorTechnician },
  { value: "student", label: t.adminPage.roleStudent },
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
