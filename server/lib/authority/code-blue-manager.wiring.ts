/**
 * Phase 4 PR 4.2 — Code Blue manager evaluator route wiring helper.
 *
 * Composes the existing resolver framework into the input shape consumed by
 * the PR 4.1 Code Blue manager evaluator. Used by POST /api/code-blue/sessions
 * (PR 4.2) and PATCH /api/code-blue/sessions/:id/end (PR 4.3).
 *
 * Invariants enforced here (master plan §5 and §17):
 *   - Loads the TARGET manager from `vt_users` by id, clinic-scoped via the
 *     request's `clinicId`. Never reads `req.authoritySnapshot` — that
 *     snapshot belongs to the request actor, not the manager.
 *   - Constructs a target-user object from DB fields only (id, name, role).
 *     No JWT, no client input.
 *   - Invokes the existing `resolveAuthority()` resolver for the target user.
 *     No parallel resolver path.
 *   - Wraps the resolver call in try/catch and surfaces `resolver_fault` to
 *     the evaluator (fail-open posture per master plan §9 / DECISION-2).
 *   - Cross-clinic guard: if the DB row's `clinicId` mismatches the request's
 *     `clinicId`, returns `cross_clinic` without resolving authority.
 *   - Soft-deleted users (`deleted_at IS NOT NULL`) are treated as missing.
 *
 * This module does NOT take an Express `req` parameter. The wiring is callable
 * from any context (route handler, future sweeper, tests) and depends only on
 * primitive inputs.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, users } from "../../db.js";
import { resolveAuthority } from "../authority.js";
import { evaluateCodeBlueManagerAuthority } from "./enforcement/code-blue-manager.evaluator.js";
import type {
  CodeBlueManagerContext,
  CodeBlueManagerEndpoint,
  CodeBlueManagerLookup,
  CodeBlueManagerVerdict,
} from "./enforcement/code-blue-manager.types.js";

export interface EvaluateCodeBlueManagerForRouteInput {
  clinicId: string;
  managerUserId: string;
  endpoint: CodeBlueManagerEndpoint;
  now?: Date;
}

export interface EvaluateCodeBlueManagerForRouteResult {
  verdict: CodeBlueManagerVerdict;
  /** The lookup discriminator that produced the verdict — for tests + audit. */
  lookupKind: CodeBlueManagerLookup["kind"];
}

/**
 * Load the target manager's authority snapshot through the existing resolver
 * framework. Pure async function; no Express dependency. Defensive against
 * DB failures (treated as `resolver_fault`, not `user_missing`).
 */
export async function loadCodeBlueManagerLookup(
  input: { clinicId: string; managerUserId: string; now: Date },
): Promise<CodeBlueManagerLookup> {
  let row: { id: string; clinicId: string; name: string; role: string; deletedAt: Date | null } | null = null;
  try {
    const rows = await db
      .select({
        id: users.id,
        clinicId: users.clinicId,
        name: users.name,
        role: users.role,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(
        and(
          eq(users.id, input.managerUserId),
          isNull(users.deletedAt),
        ),
      )
      .limit(1);
    row = rows[0] ?? null;
  } catch {
    return { kind: "resolver_fault" };
  }

  if (!row) {
    return { kind: "user_missing" };
  }

  if (row.clinicId !== input.clinicId) {
    return { kind: "cross_clinic" };
  }

  try {
    const snapshot = await resolveAuthority({
      authUser: {
        id: row.id,
        name: row.name,
        role: row.role,
        // Phase 2B contract: secondaryRole is NEVER propagated through the
        // resolver. The DB column exists but is intentionally not consulted.
        secondaryRole: null,
      },
      clinicId: input.clinicId,
      now: input.now,
    });
    return { kind: "snapshot", snapshot };
  } catch {
    return { kind: "resolver_fault" };
  }
}

/**
 * One-shot wiring helper: load the target manager and run the Code Blue
 * manager evaluator. The verdict's mode-dependent side effects (audit, metric)
 * are emitted internally by the evaluator.
 *
 * In PR 4.2 / 4.3 the caller does NOT act on `verdict.action === "deny"` —
 * shadow-mode observation only. PR 4.5 introduces the enforce-mode response
 * translation in a separate additive PR.
 */
export async function evaluateCodeBlueManagerForRoute(
  input: EvaluateCodeBlueManagerForRouteInput,
): Promise<EvaluateCodeBlueManagerForRouteResult> {
  const now = input.now ?? new Date();
  const lookup = await loadCodeBlueManagerLookup({
    clinicId: input.clinicId,
    managerUserId: input.managerUserId,
    now,
  });
  const ctx: CodeBlueManagerContext = {
    clinicId: input.clinicId,
    now,
    endpoint: input.endpoint,
    managerUserId: input.managerUserId,
    lookup,
  };
  const verdict = await evaluateCodeBlueManagerAuthority(ctx);
  return { verdict, lookupKind: lookup.kind };
}
