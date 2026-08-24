import type { Response } from "express";
import { db, users } from "../../db.js";
import { eq, and, inArray } from "drizzle-orm";
import { evaluateCodeBlueManagerForRoute } from "../../lib/authority/code-blue-manager.wiring.js";
import { apiError } from "../../lib/route-utils.js";

/**
 * Shared manager authority evaluator + validation for Code Blue initiation.
 * Used identically by POST /sessions and POST /one-tap (same clinical
 * contract — see either call site for the Phase 4 PR 4.2 + PR 4.5 evaluator
 * wiring rationale in full).
 *
 * Runs BEFORE any side effect (DB insert, push fan-out, system message,
 * "started" audit). In enforce mode the evaluator may return `action: "deny"`,
 * which this function translates into a 403 with a stable reason code BEFORE
 * any side effect commits. In shadow / off / mode-inactive / fault-open paths
 * the verdict is `action: "allow"` and the caller proceeds as before.
 * Per-clinic vt_server_config `code_blue.manager_enforce.<clinicId>.initiation
 * = "enforce"` activates the deny path; default (`off`) is unchanged.
 *
 * The evaluator can also deny with USER_MISSING or MANAGER_CROSS_CLINIC,
 * which are INPUT VALIDATION failures (the nominated managerUserId points to
 * a non-existent or cross-clinic user), distinct from operational-role
 * denials — those reasons fall through to the existing managerUser DB lookup,
 * which returns the INVALID_MANAGER 400. Only operational-role denials
 * (OPROLE_NOT_IN_CB_ALLOWLIST, NO_OPEN_CHECK_IN) return the 403
 * MANAGER_NOT_CODE_BLUE_ELIGIBLE response.
 *
 * Returns the manager row on success, or `null` after already writing the
 * error response to `res` — callers do `if (!manager) return;`.
 */
export async function resolveNominatedManager(
  res: Response,
  requestId: string,
  clinicId: string,
  managerUserId: string,
): Promise<{ id: string; name: string } | null> {
  const { verdict } = await evaluateCodeBlueManagerForRoute({
    clinicId,
    managerUserId,
    endpoint: "initiation",
    now: new Date(),
  });
  if (verdict.action === "deny") {
    const reason = verdict.reason;
    if (reason === "OPROLE_NOT_IN_CB_ALLOWLIST" || reason === "NO_OPEN_CHECK_IN") {
      res.status(403).json(
        apiError({
          code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE",
          reason,
          message: "Nominated manager is not currently Code-Blue-eligible (operational role check)",
          requestId,
        }),
      );
      return null;
    }
    // USER_MISSING / MANAGER_CROSS_CLINIC: continue to the managerUser DB
    // lookup below, which returns 400 INVALID_MANAGER.
  }

  const [managerUser] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.id, managerUserId),
        eq(users.clinicId, clinicId),
        inArray(users.role, ["vet", "admin"]),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!managerUser) {
    res.status(400).json(
      apiError({ code: "INVALID_MANAGER", reason: "INVALID_MANAGER", message: "Manager must be an active vet or admin in this clinic", requestId }),
    );
    return null;
  }

  return managerUser;
}
