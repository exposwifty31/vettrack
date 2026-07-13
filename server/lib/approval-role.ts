/**
 * Role resolution for admin approval of a pending sign-up (C3, gated
 * role-onboarding).
 *
 * On the pending → active transition the user is promoted to the role they
 * self-requested at sign-up (`vt_users.requestedRole`), so the admin does not
 * re-select it — unless the admin passes an explicit override. Only the
 * self-selectable roles ever reach `requestedRole` (see `sanitizeRequestedRole`
 * in server/middleware/auth.ts), so this can never auto-grant admin/senior.
 *
 * SECURITY: vet is clinical authority level 30 — the "dangerous" grant. A vet
 * approval requires a doctor/license number on the row (the admin verifies it).
 * Post-approval, admins still promote tech → senior/lead via the unrestricted
 * `PATCH /:id/role` endpoint, which is not gated here.
 */

export interface ApprovalRoleInput {
  currentStatus: string;
  newStatus: string;
  requestedRole: string | null;
  /** Explicit admin override (from the approval UI). Wins over `requestedRole`. */
  overrideRole: string | null;
  vetLicenseNumber: string | null;
}

export type ApprovalRoleResult =
  | { ok: true; roleToApply: string | null }
  | { ok: false; error: "VET_LICENSE_REQUIRED" };

/** Roles a user may self-select at sign-up and have auto-granted on approval. */
const SELF_APPLICABLE_ROLES = new Set(["vet", "technician"]);

export function resolveApprovalRole(input: ApprovalRoleInput): ApprovalRoleResult {
  const isApproval = input.currentStatus === "pending" && input.newStatus === "active";
  if (!isApproval) {
    return { ok: true, roleToApply: null };
  }

  // An explicit admin override is a deliberate choice and may be any valid role.
  // A self-requested role is auto-applied ONLY within the self-selection
  // boundary (vet | technician) — a stale/legacy "student" (or anything else)
  // that reached the staging column is never auto-granted here.
  let roleToApply: string | null = null;
  if (input.overrideRole) {
    roleToApply = input.overrideRole;
  } else if (input.requestedRole && SELF_APPLICABLE_ROLES.has(input.requestedRole)) {
    roleToApply = input.requestedRole;
  }

  if (!roleToApply) {
    return { ok: true, roleToApply: null };
  }

  if (roleToApply === "vet" && !input.vetLicenseNumber?.trim()) {
    return { ok: false, error: "VET_LICENSE_REQUIRED" };
  }

  return { ok: true, roleToApply };
}
