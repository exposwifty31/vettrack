/**
 * Phase 2B: requireClinicalAuthority middleware.
 *
 * Consumes the existing single authority resolver
 * (server/lib/authority.ts → resolveAuthority). Does NOT define a
 * second resolver, does NOT duplicate shift-lookup logic.
 *
 * Identity-vs-shift disambiguation:
 *  - `req.authUser.role === "admin"` is an IDENTITY check
 *    (vt_users.role).
 *  - `snapshot.effectiveClinicalRole` is a SHIFT-derived clinical
 *    authority value (vt_shifts.role normalized; "admin"/"student"
 *    already dropped to null by the Phase 2A normalizer).
 *
 * Phase 2B contract:
 *  - Identity admin bypass ONLY when opts.allowSystemAdmin === true.
 *  - secondaryRole is never consulted. Passed as null to
 *    resolveAuthority for redundancy with the resolver's internal rule.
 *  - This middleware coexists with `requireClinicalUser` — it does NOT
 *    replace it. Routes must keep `requireClinicalUser` at the router
 *    level so a regression in shift resolution cannot let students
 *    through.
 *  - `allowPermanentClinicalRoleFallbackForLegacyDispense` is a
 *    TRANSITIONAL dispense-only option that admits a clinical-non-student
 *    identity whose snapshot has effectiveClinicalRole=null and
 *    reason="EZSHIFT_NONE" if their permanent clinicalRole is in
 *    allow[]. It MUST NOT be used by any non-dispense consumer; this is
 *    enforced by tests/authority-middleware-zero-consumers.test.ts (and
 *    later tests/dispense-authority-enforcement.test.ts).
 */

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

import type {
  ActiveShiftRole,
  AuthoritySnapshot,
} from "../../shared/authority.js";

import { recordAccessDenied } from "../lib/access-denied.js";
import { resolveAuthority } from "../lib/authority.js";
import {
  emitAuthorityDeniedAudit,
  emitAuthorityResolutionFailedAudit,
  emitCodeBlueBreakGlassAudit,
  emitDispenseLegacyFallbackAudit,
  isAuthorityObsV1Enabled,
} from "../lib/authority-audit.js";
import { incrementMetric } from "../lib/metrics.js";

const VALID_ALLOW_ROLES: ReadonlySet<ActiveShiftRole> = new Set<ActiveShiftRole>([
  "vet",
  "senior_technician",
  "technician",
]);

export interface RequireClinicalAuthorityOptions {
  allow: readonly ActiveShiftRole[];
  allowSystemAdmin?: boolean;

  /**
   * TRANSITIONAL — dispense-only.
   *
   * When true, a clinical-non-student identity whose snapshot has:
   *   effectiveClinicalRole === null
   *   reason === "EZSHIFT_NONE"
   *
   * may still pass if their permanent clinicalRole is in allow[].
   *
   * Preserves legacy dispense compatibility.
   *
   * MUST NOT be used outside dispense.
   */
  allowPermanentClinicalRoleFallbackForLegacyDispense?: true;

  /**
   * EMERGENCY BREAK-GLASS — Code Blue initiation only (Phase 10a T1).
   *
   * When true, a clinical-non-student identity whose snapshot has:
   *   effectiveClinicalRole === null
   *   reason === "EZSHIFT_NONE"
   *
   * may still pass if their permanent clinicalRole is in allow[].
   *
   * Rationale: a cardiac arrest must not wait on roster scheduling. This is an
   * INDEPENDENT opt-in from the dispense fallback above — it emits its own
   * distinct metric + audit and does NOT widen or reuse the dispense flag.
   *
   * Set ONLY on POST /api/code-blue/sessions. MUST NOT be used by any other
   * consumer, and it never elevates a student (clinicalRole "student" is
   * excluded) nor resurrects a stale/revoked check-in (reason must be
   * EZSHIFT_NONE).
   */
  allowPermanentClinicalRoleForEmergency?: true;
}

declare global {
  namespace Express {
    interface Request {
      authoritySnapshot?: AuthoritySnapshot;
    }
  }
}

function resolveRequestId(req: Request, res: Response): string {
  const headerVal = req.headers["x-request-id"];
  if (typeof headerVal === "string" && headerVal.trim().length > 0) {
    return headerVal.trim();
  }
  if (typeof res.getHeader === "function") {
    const existing = res.getHeader("x-request-id");
    if (typeof existing === "string" && existing.trim().length > 0) {
      return existing.trim();
    }
  }
  return randomUUID();
}

export function requireClinicalAuthority(
  opts: RequireClinicalAuthorityOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  if (opts.allow.length === 0) {
    throw new Error(
      "requireClinicalAuthority: opts.allow must be non-empty",
    );
  }
  for (const role of opts.allow) {
    if (!VALID_ALLOW_ROLES.has(role)) {
      throw new Error(
        `requireClinicalAuthority: invalid allow role: ${String(role)}`,
      );
    }
  }

  return async function requireClinicalAuthorityMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const requestId = resolveRequestId(req, res);

    if (!req.authUser) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        error: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Unauthorized",
        requestId,
      });
      return;
    }

    // Phase 2.5 PR 5: narrow catch scope to the resolveAuthority call only,
    // so that a downstream error (audit emission, recordAccessDenied) can't
    // re-enter the 500 path. Counter increment is always-on; durable audit
    // and console.error are gated by AUTHORITY_OBS_V1 inside the audit module.
    let snapshot: AuthoritySnapshot;
    try {
      snapshot = await resolveAuthority({
        authUser: {
          id: req.authUser.id,
          name: req.authUser.name,
          role: req.authUser.role,
          // Phase 2B contract:
          // secondaryRole is NEVER propagated.
          // Resolver already ignores it internally;
          // pass null for redundancy.
          secondaryRole: null,
        },
        clinicId: req.clinicId!,
      });
    } catch (err) {
      incrementMetric("authority_resolution_failed");
      if (isAuthorityObsV1Enabled()) {
        console.error("[authority] resolution failed", err);
      }
      emitAuthorityResolutionFailedAudit({ req, error: err });
      res.status(500).json({
        code: "INTERNAL_ERROR",
        error: "INTERNAL_ERROR",
        reason: "AUTHORITY_RESOLUTION_FAILED",
        message: "Authority resolution failed",
        requestId,
      });
      return;
    }

    req.authoritySnapshot = snapshot;
    incrementResolutionSourceMetric(snapshot);

    if (opts.allowSystemAdmin === true && req.authUser.role === "admin") {
      next();
      return;
    }

    if (
      snapshot.effectiveClinicalRole !== null &&
      opts.allow.includes(snapshot.effectiveClinicalRole)
    ) {
      next();
      return;
    }

    const fallbackOpted =
      opts.allowPermanentClinicalRoleFallbackForLegacyDispense === true;

    if (fallbackOpted) {
      if (
        snapshot.effectiveClinicalRole === null &&
        snapshot.reason === "EZSHIFT_NONE" &&
        snapshot.clinicalRole !== null &&
        snapshot.clinicalRole !== "student" &&
        opts.allow.includes(snapshot.clinicalRole as ActiveShiftRole)
      ) {
        incrementMetric("authority_legacy_fallback_used");
        emitDispenseLegacyFallbackAudit({ req, snapshot });
        next();
        return;
      }
    }

    // Phase 10a T1: emergency break-glass for Code Blue initiation. Independent
    // of the dispense fallback above — a route sets at most one of the two
    // flags, and both require effectiveClinicalRole === null so neither shadows
    // the other. Same predicate as the dispense branch, but a distinct metric +
    // audit so break-glass grants are separable from dispense compatibility.
    const emergencyBreakGlassOpted =
      opts.allowPermanentClinicalRoleForEmergency === true;

    if (emergencyBreakGlassOpted) {
      if (
        snapshot.effectiveClinicalRole === null &&
        snapshot.reason === "EZSHIFT_NONE" &&
        snapshot.clinicalRole !== null &&
        snapshot.clinicalRole !== "student" &&
        opts.allow.includes(snapshot.clinicalRole as ActiveShiftRole)
      ) {
        incrementMetric("authority_emergency_break_glass_used");
        emitCodeBlueBreakGlassAudit({ req, snapshot });
        next();
        return;
      }
    }

    // Phase 2.5 PR 5 follow-up: classify denial by branch OUTCOME, not by
    // whether the route opted into the fallback. LEGACY_FALLBACK_NOT_MATCHED
    // only fires when the fallback branch was actually attempted — i.e., the
    // user had no effective shift authority AND was eligible (null effective
    // role + EZSHIFT_NONE) — and the permanent-role test failed. A denial
    // where effectiveClinicalRole is non-null (just not in allow) belongs in
    // ROLE_NOT_IN_ALLOW even when fallback was opted, because the fallback
    // branch was never reachable.
    const fallbackAttempted =
      fallbackOpted &&
      snapshot.effectiveClinicalRole === null &&
      snapshot.reason === "EZSHIFT_NONE";
    const denialKind = fallbackAttempted
      ? "LEGACY_FALLBACK_NOT_MATCHED"
      : "ROLE_NOT_IN_ALLOW";
    incrementMetric(
      denialKind === "ROLE_NOT_IN_ALLOW"
        ? "authority_denied_role_not_in_allow"
        : "authority_denied_legacy_fallback_not_matched",
    );
    emitAuthorityDeniedAudit({ req, snapshot, denialKind });

    recordAccessDenied({
      req,
      source: "requireClinicalAuthority",
      statusCode: 403,
      reason: "INSUFFICIENT_ROLE",
      message: "Clinical authority required",
    });

    res.status(403).json({
      code: "INSUFFICIENT_ROLE",
      error: "INSUFFICIENT_ROLE",
      reason: "INSUFFICIENT_CLINICAL_AUTHORITY",
      message: "Clinical authority required",
      requestId,
    });
  };
}

function incrementResolutionSourceMetric(snapshot: AuthoritySnapshot): void {
  switch (snapshot.source) {
    case "check_in":
      incrementMetric("authority_resolution_source_check_in");
      return;
    case "shift":
      incrementMetric("authority_resolution_source_shift");
      return;
    case "no_active_shift":
      incrementMetric("authority_resolution_source_no_active_shift");
      return;
  }
}
