/**
 * Phase 2A PR 2: Authority resolver.
 *
 * Additive scaffolding only — NOT consumed by any route, middleware, or
 * frontend in Phase 2A. The legacy authorization stack
 * (requireEffectiveRole, requireRole, requireAdmin, ROLE_HIERARCHY,
 * resolveCurrentRole) remains fully authoritative until Phase 2B.
 *
 * This module wraps resolveCurrentRole() so that Phase 2A snapshots reflect
 * the new authority model rather than the legacy max-of effectiveRole.
 *
 * Load-bearing rules enforced here:
 *   - A user whose identity ClinicalRole is "student" never resolves to
 *     activeShiftRole / effectiveClinicalRole, even with an active clinical
 *     shift row (student hard stop).
 *   - shift.role values of "admin", "student", or unknown never grant
 *     activeShiftRole / effectiveClinicalRole. (A user whose permanent role is
 *     "admin" but who picks up a clinical shift row still gains that shift's
 *     clinical authority for the shift's duration — matches legacy semantics.)
 *   - secondaryRole is never consulted (passed as null to legacy resolver).
 *   - operationalRole is always null in Phase 2A.
 */

import type {
  ActiveShiftRole,
  AuthoritySnapshot,
  ClinicalRole,
  SystemRole,
} from "../../shared/authority.js";
import {
  mapLegacyRoleToClinicalRole,
  mapLegacyRoleToSystemRole,
  normalizeShiftRoleToClinical,
} from "./authority-roles.js";
import {
  resolveCurrentRole,
  type PermanentVetTrackRole,
} from "./role-resolution.js";

export type ResolveAuthorityInput = {
  authUser: {
    id: string;
    name?: string | null;
    role: string;
    secondaryRole?: string | null;
  };
  clinicId: string;
  now?: Date;
};

function buildSnapshot(args: {
  systemRole: SystemRole;
  clinicalRole: ClinicalRole | null;
  activeShiftRole: ActiveShiftRole | null;
  effectiveClinicalRole: ActiveShiftRole | null;
  source: AuthoritySnapshot["source"];
  reason: AuthoritySnapshot["reason"];
  resolvedAt: string;
}): AuthoritySnapshot {
  return {
    systemRole: args.systemRole,
    clinicalRole: args.clinicalRole,
    activeShiftRole: args.activeShiftRole,
    operationalRole: null,
    effectiveClinicalRole: args.effectiveClinicalRole,
    source: args.source,
    reason: args.reason,
    resolvedAt: args.resolvedAt,
  };
}

export async function resolveAuthority(
  input: ResolveAuthorityInput,
): Promise<AuthoritySnapshot> {
  const now = input.now ?? new Date();
  const resolvedAt = now.toISOString();

  const systemRole = mapLegacyRoleToSystemRole(input.authUser.role);
  const clinicalRole = mapLegacyRoleToClinicalRole(input.authUser.role);

  // Student hard stop — applies regardless of any active shift.
  if (clinicalRole === "student") {
    return buildSnapshot({
      systemRole,
      clinicalRole,
      activeShiftRole: null,
      effectiveClinicalRole: null,
      source: "no_active_shift",
      reason: "STUDENT_NEVER_ELEVATED",
      resolvedAt,
    });
  }

  const trimmedName = (input.authUser.name ?? "").trim();

  let result: Awaited<ReturnType<typeof resolveCurrentRole>>;
  try {
    result = await resolveCurrentRole({
      clinicId: input.clinicId,
      userId: input.authUser.id,
      userName: trimmedName,
      fallbackRole: input.authUser.role as PermanentVetTrackRole,
      // Phase 2A: secondaryRole must NEVER grant clinical authority here.
      secondaryRole: null,
      // Pass the same `now` we used for resolvedAt so shift-boundary matching
      // and the snapshot timestamp stay consistent when input.now is omitted.
      now,
    });
  } catch {
    return buildSnapshot({
      systemRole,
      clinicalRole,
      activeShiftRole: null,
      effectiveClinicalRole: null,
      source: "no_active_shift",
      reason: "RESOLUTION_ERROR",
      resolvedAt,
    });
  }

  if (result.source === "shift" && result.activeShift) {
    const normalized = normalizeShiftRoleToClinical(result.activeShift.role);
    if (normalized !== null) {
      return buildSnapshot({
        systemRole,
        clinicalRole,
        activeShiftRole: normalized,
        effectiveClinicalRole: normalized,
        source: "shift",
        reason: "EZSHIFT_ACTIVE",
        resolvedAt,
      });
    }
    return buildSnapshot({
      systemRole,
      clinicalRole,
      activeShiftRole: null,
      effectiveClinicalRole: null,
      source: "no_active_shift",
      reason: "SHIFT_ROLE_NOT_CLINICAL",
      resolvedAt,
    });
  }

  // No usable active shift.
  if (!trimmedName) {
    return buildSnapshot({
      systemRole,
      clinicalRole,
      activeShiftRole: null,
      effectiveClinicalRole: null,
      source: "no_active_shift",
      reason: "MISSING_USER_NAME",
      resolvedAt,
    });
  }

  if (clinicalRole === null && systemRole === "Admin") {
    return buildSnapshot({
      systemRole,
      clinicalRole,
      activeShiftRole: null,
      effectiveClinicalRole: null,
      source: "no_active_shift",
      reason: "LEGACY_ADMIN_NO_CLINICAL",
      resolvedAt,
    });
  }

  return buildSnapshot({
    systemRole,
    clinicalRole,
    activeShiftRole: null,
    effectiveClinicalRole: null,
    source: "no_active_shift",
    reason: "EZSHIFT_NONE",
    resolvedAt,
  });
}
