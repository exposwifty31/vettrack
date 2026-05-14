/**
 * Phase 2A PR 2: Authority resolver.
 * Phase 2.5 PR 3: Clinical check-in authority source.
 *
 * Resolver consumed by requireClinicalAuthority middleware (Phase 2B+). The
 * legacy authorization stack (requireEffectiveRole, requireRole, requireAdmin,
 * ROLE_HIERARCHY, resolveCurrentRole) remains intact for non-clinical paths.
 *
 * Load-bearing rules enforced here:
 *   - A user whose identity ClinicalRole is "student" never resolves to
 *     activeShiftRole / effectiveClinicalRole, even with an active clinical
 *     shift row or an open check-in row (student hard stop, first).
 *   - shift.role values of "admin", "student", or unknown never grant
 *     activeShiftRole / effectiveClinicalRole. (A user whose permanent role is
 *     "admin" but who picks up a clinical shift row still gains that shift's
 *     clinical authority for the shift's duration — matches legacy semantics.)
 *   - secondaryRole is never consulted (passed as null to legacy resolver).
 *
 * Phase 2.5 PR 3 (gated by request-time env AUTHORITY_USE_CHECKIN_PATH=true):
 *   - When a valid open vt_clinical_check_ins row exists for (clinicId, userId),
 *     it is monotonic / sticky: effectiveClinicalRole = clinicalRoleAtCheckIn,
 *     and the shift-derived role is observational only (drift detection +
 *     activeShiftRole population). A shift-lookup failure after a successful
 *     check-in lookup must NOT invalidate the check-in snapshot.
 *   - When no open row exists (or the flag is off), behavior falls through to
 *     the legacy branches unchanged (Strategy A): byte-for-byte identical
 *     snapshot to Phase 2C for every legacy path.
 *   - operationalRole is populated from checkIn.operationalRole when a row
 *     exists, otherwise null (matching pre-PR-3 behavior).
 */

import type {
  ActiveShiftRole,
  AuthoritySnapshot,
  ClinicalRole,
  OperationalRole,
  SystemRole,
} from "../../shared/authority.js";
import {
  mapLegacyRoleToClinicalRole,
  mapLegacyRoleToSystemRole,
  normalizeShiftRoleToClinical,
} from "./authority-roles.js";
import { getOpenClinicalCheckIn } from "./check-in-resolution.js";
import { createLogLimiter } from "./log-safety.js";
import { incrementMetric } from "./metrics.js";
import {
  resolveCurrentRole,
  type PermanentVetTrackRole,
  type RoleResolutionResult,
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

const authorityDriftLogLimiter = createLogLimiter({
  dedupeWindowMs: 60_000,
  sampleRate: 1,
  maxEntries: 200,
});

type AuthorityDriftEvent =
  | "checkin_shift_role_drift"
  | "checkin_shift_lookup_failed";

function emitAuthorityDrift(event: {
  event: AuthorityDriftEvent;
  clinicId: string;
  userId: string;
  checkInRole: string;
  shiftRole: string | null;
  timestamp: string;
}): void {
  // Counter is always-on and increments on every drift observation, even when
  // the log limiter suppresses the warn line. Counter volume is the
  // ground-truth signal for drift; the warn line is sampled context.
  if (event.event === "checkin_shift_role_drift") {
    incrementMetric("authority_drift_role");
  } else {
    incrementMetric("authority_drift_shift_lookup_failed");
  }

  const key = `${event.event}:${event.clinicId}:${event.userId}`;
  if (!authorityDriftLogLimiter.shouldLog(key)) return;
  console.warn("[authority-drift]", JSON.stringify(event));
}

function buildSnapshot(args: {
  systemRole: SystemRole;
  clinicalRole: ClinicalRole | null;
  activeShiftRole: ActiveShiftRole | null;
  effectiveClinicalRole: ActiveShiftRole | null;
  operationalRole?: OperationalRole;
  source: AuthoritySnapshot["source"];
  reason: AuthoritySnapshot["reason"];
  resolvedAt: string;
}): AuthoritySnapshot {
  return {
    systemRole: args.systemRole,
    clinicalRole: args.clinicalRole,
    activeShiftRole: args.activeShiftRole,
    operationalRole: args.operationalRole ?? null,
    effectiveClinicalRole: args.effectiveClinicalRole,
    source: args.source,
    reason: args.reason,
    resolvedAt: args.resolvedAt,
  };
}

function isCheckInPathEnabled(): boolean {
  return process.env.AUTHORITY_USE_CHECKIN_PATH === "true";
}

export async function resolveAuthority(
  input: ResolveAuthorityInput,
): Promise<AuthoritySnapshot> {
  const now = input.now ?? new Date();
  const resolvedAt = now.toISOString();

  const systemRole = mapLegacyRoleToSystemRole(input.authUser.role);
  const clinicalRole = mapLegacyRoleToClinicalRole(input.authUser.role);

  // Student hard stop — applies regardless of any active shift or check-in.
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

  // Phase 2.5 PR 3: check-in path is gated by request-time env flag.
  // Missing-name users skip the check-in lookup entirely; their resolution
  // continues through the legacy branches below, which emit MISSING_USER_NAME
  // exactly as before.
  if (isCheckInPathEnabled() && trimmedName) {
    let checkIn: Awaited<ReturnType<typeof getOpenClinicalCheckIn>>;
    try {
      checkIn = await getOpenClinicalCheckIn({
        clinicId: input.clinicId,
        userId: input.authUser.id,
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

    if (checkIn) {
      // Shift resolution after a valid check-in is advisory only:
      //  - success → populate activeShiftRole + drift compare
      //  - failure → emit structured warning, do NOT invalidate check-in
      let shiftResult: RoleResolutionResult | null = null;
      try {
        shiftResult = await resolveCurrentRole({
          clinicId: input.clinicId,
          userId: input.authUser.id,
          userName: trimmedName,
          fallbackRole: input.authUser.role as PermanentVetTrackRole,
          secondaryRole: null,
          now,
        });
      } catch {
        emitAuthorityDrift({
          event: "checkin_shift_lookup_failed",
          clinicId: input.clinicId,
          userId: input.authUser.id,
          checkInRole: checkIn.clinicalRoleAtCheckIn,
          shiftRole: null,
          timestamp: resolvedAt,
        });
      }

      const observedShiftRole = shiftResult
        ? normalizeShiftRoleToClinical(shiftResult.activeShift?.role ?? null)
        : null;

      if (
        observedShiftRole !== null &&
        observedShiftRole !== checkIn.clinicalRoleAtCheckIn
      ) {
        emitAuthorityDrift({
          event: "checkin_shift_role_drift",
          clinicId: input.clinicId,
          userId: input.authUser.id,
          checkInRole: checkIn.clinicalRoleAtCheckIn,
          shiftRole: observedShiftRole,
          timestamp: resolvedAt,
        });
      }

      const effectiveClinicalRole =
        checkIn.clinicalRoleAtCheckIn as ActiveShiftRole;
      const operationalRole =
        (checkIn.operationalRole as OperationalRole | null) ?? null;

      return buildSnapshot({
        systemRole,
        clinicalRole,
        activeShiftRole: observedShiftRole,
        effectiveClinicalRole,
        operationalRole,
        source: "check_in",
        reason: operationalRole ? "CHECKED_IN" : "CHECKED_IN_NO_OPROLE",
        resolvedAt,
      });
    }
    // No open check-in row → fall through to legacy resolution.
  }

  let result: RoleResolutionResult;
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
