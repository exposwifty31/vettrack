// Lands at: src/components/ui/role-badge.tsx
// §20-D5 — thin wrapper over the real StatusBadge; no new colors (§20-D1).
import * as React from "react";
import { StatusBadge, type StatusBadgeProps } from "@/components/ui/status-badge";
import { roleToStatusKind, type RoleKind } from "@/core/entities/design-tokens";
import { t } from "@/lib/i18n";

export interface RoleBadgeProps
  extends Omit<StatusBadgeProps, "kind" | "label"> {
  role: RoleKind;
  /** Override the label (rare). Falls back to t.roles[role]. */
  label?: string;
}

const ROLE_LABEL: Record<RoleKind, () => string> = {
  admin: () => t.roles.admin,
  vet: () => t.roles.vet,
  senior_technician: () => t.roles.senior_technician,
  lead_technician: () => t.roles.lead_technician,
  vet_tech: () => t.roles.vet_tech,
  technician: () => t.roles.technician,
  student: () => t.roles.student,
};

export function RoleBadge({ role, label, ...props }: RoleBadgeProps) {
  return (
    <StatusBadge
      kind={roleToStatusKind(role)}
      label={label ?? ROLE_LABEL[role]()}
      {...props}
    />
  );
}
