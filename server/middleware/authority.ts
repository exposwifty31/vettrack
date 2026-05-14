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

    try {
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

      const snapshot = await resolveAuthority({
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

      req.authoritySnapshot = snapshot;

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

      if (opts.allowPermanentClinicalRoleFallbackForLegacyDispense === true) {
        if (
          snapshot.effectiveClinicalRole === null &&
          snapshot.reason === "EZSHIFT_NONE" &&
          snapshot.clinicalRole !== null &&
          snapshot.clinicalRole !== "student" &&
          opts.allow.includes(snapshot.clinicalRole as ActiveShiftRole)
        ) {
          next();
          return;
        }
      }

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
      return;
    } catch {
      res.status(500).json({
        code: "INTERNAL_ERROR",
        error: "INTERNAL_ERROR",
        reason: "AUTHORITY_RESOLUTION_FAILED",
        message: "Authority resolution failed",
        requestId,
      });
      return;
    }
  };
}
