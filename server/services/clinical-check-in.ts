import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  clinicalCheckIns,
  db,
  users,
  type ClinicalCheckIn,
} from "../db.js";
import { logAudit } from "../lib/audit.js";

export const OPERATIONAL_ROLES = [
  "admission",
  "ward",
  "senior_lead",
  "night_admission_only",
  "night_senior_no_admission",
] as const;
export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

const OPERATIONAL_ROLE_SET = new Set<string>(OPERATIONAL_ROLES);

export type CheckInSource = "self" | "session_close" | "admin_force";

/**
 * Mirror exactly the union from `req.authUser.role` (server/middleware/auth.ts).
 * Do not narrow here — narrowing happens inside `openCheckIn` so admin / unknown
 * roles produce a consistent `ROLE_NOT_ELIGIBLE_FOR_CHECK_IN` error.
 */
export type ActorRole =
  | "admin"
  | "vet"
  | "senior_technician"
  | "technician"
  | "student";

export type CheckInActor = {
  userId: string;
  email: string;
  clinicId: string;
  role: ActorRole;
};

export type CheckInInput = {
  actor: CheckInActor;
  operationalRole?: unknown;
  idempotencyKey?: string | null;
};

export type CheckInResult = { row: ClinicalCheckIn; replayed: boolean };

export class ClinicalCheckInError extends Error {
  status: number;
  code: string;
  reason: string;
  constructor(status: number, code: string, message: string, reason: string = code) {
    super(message);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.name = "ClinicalCheckInError";
  }
}

const REPLAY_WINDOW_MS = 60_000;

function isUniqueConstraintViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const o = err as { code?: string; cause?: { code?: string } };
  return o.code === "23505" || o.cause?.code === "23505";
}

export async function getAllowedOperationalRoles(
  userId: string,
  clinicId: string,
): Promise<OperationalRole[]> {
  const [row] = await db
    .select({ allowed: users.allowedOperationalRoles })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
    .limit(1);

  const raw = row?.allowed;
  if (!Array.isArray(raw)) return [];
  const filtered: OperationalRole[] = [];
  for (const value of raw) {
    if (typeof value === "string" && OPERATIONAL_ROLE_SET.has(value)) {
      filtered.push(value as OperationalRole);
    }
  }
  return filtered;
}

export async function getActiveCheckIn(
  clinicId: string,
  userId: string,
): Promise<ClinicalCheckIn | null> {
  const [row] = await db
    .select()
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        eq(clinicalCheckIns.userId, userId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function openCheckIn(input: CheckInInput): Promise<CheckInResult> {
  const { actor } = input;
  const idempotencyKey = input.idempotencyKey ?? null;

  if (
    input.operationalRole !== undefined &&
    typeof input.operationalRole !== "string"
  ) {
    throw new ClinicalCheckInError(
      400,
      "OPERATIONAL_ROLE_INVALID",
      "operationalRole must be a string",
    );
  }

  const operationalRoleInput =
    typeof input.operationalRole === "string" ? input.operationalRole : undefined;

  let storedOperationalRole: OperationalRole | null;

  switch (actor.role) {
    case "student":
      throw new ClinicalCheckInError(
        403,
        "STUDENT_NOT_CLINICAL",
        "Students cannot perform clinical check-in",
      );
    case "vet": {
      if (!operationalRoleInput || operationalRoleInput.length === 0) {
        throw new ClinicalCheckInError(
          400,
          "OPERATIONAL_ROLE_REQUIRED_FOR_VET",
          "operationalRole is required for vet check-in",
        );
      }
      if (!OPERATIONAL_ROLE_SET.has(operationalRoleInput)) {
        throw new ClinicalCheckInError(
          400,
          "OPERATIONAL_ROLE_UNKNOWN",
          "operationalRole is not a recognised role",
        );
      }
      const allowed = await getAllowedOperationalRoles(actor.userId, actor.clinicId);
      if (allowed.length === 0) {
        throw new ClinicalCheckInError(
          403,
          "NO_ALLOWED_OPERATIONAL_ROLES",
          "User has no allowed operational roles configured",
        );
      }
      if (!allowed.includes(operationalRoleInput as OperationalRole)) {
        throw new ClinicalCheckInError(
          403,
          "OPERATIONAL_ROLE_NOT_ALLOWED",
          "Requested operational role is not in the user's allowlist",
        );
      }
      storedOperationalRole = operationalRoleInput as OperationalRole;
      break;
    }
    case "senior_technician":
    case "technician": {
      if (operationalRoleInput !== undefined) {
        throw new ClinicalCheckInError(
          400,
          "OPERATIONAL_ROLE_NOT_ALLOWED_FOR_NON_VET",
          "operationalRole is only valid for vet check-in",
        );
      }
      storedOperationalRole = null;
      break;
    }
    case "admin":
    default:
      throw new ClinicalCheckInError(
        403,
        "ROLE_NOT_ELIGIBLE_FOR_CHECK_IN",
        "Role is not eligible for clinical check-in",
      );
  }

  const id = randomUUID();
  const clinicalRoleAtCheckIn = actor.role;

  try {
    const [inserted] = await db
      .insert(clinicalCheckIns)
      .values({
        id,
        clinicId: actor.clinicId,
        userId: actor.userId,
        operationalRole: storedOperationalRole,
        clinicalRoleAtCheckIn,
        activeShiftId: null,
        shiftSessionId: null,
        clientId: idempotencyKey,
      })
      .returning();

    // Fire-and-forget; if a future refactor wraps this path in db.transaction(...),
    // thread the tx through to logAudit({ ..., tx }) so the audit row commits atomically.
    logAudit({
      clinicId: actor.clinicId,
      actionType: "clinical_check_in",
      performedBy: actor.userId,
      performedByEmail: actor.email,
      targetId: inserted.id,
      targetType: "clinical_check_in",
      metadata: {
        checkInId: inserted.id,
        clinicId: actor.clinicId,
        userId: actor.userId,
        operationalRole: storedOperationalRole,
        source: "self",
      },
    });

    return { row: inserted, replayed: false };
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;

    const existing = await getActiveCheckIn(actor.clinicId, actor.userId);
    if (existing) {
      const trimmedKey = idempotencyKey?.trim() ?? "";
      const existingClientId = existing.clientId ?? "";
      const ageMs = Date.now() - existing.checkedInAt.getTime();
      if (
        trimmedKey.length > 0 &&
        existingClientId === trimmedKey &&
        ageMs <= REPLAY_WINDOW_MS
      ) {
        return { row: existing, replayed: true };
      }
    }
    throw new ClinicalCheckInError(
      409,
      "ALREADY_CHECKED_IN",
      "User already has an active clinical check-in",
    );
  }
}

export async function closeCheckIn(args: {
  actor: CheckInActor;
  reason: CheckInSource;
}): Promise<ClinicalCheckIn> {
  const { actor, reason } = args;
  const existing = await getActiveCheckIn(actor.clinicId, actor.userId);
  if (!existing) {
    throw new ClinicalCheckInError(
      404,
      "NOT_CHECKED_IN",
      "User has no active clinical check-in",
    );
  }

  const checkedOutAt = new Date();
  const [updated] = await db
    .update(clinicalCheckIns)
    .set({ checkedOutAt, checkOutReason: reason })
    .where(
      and(
        eq(clinicalCheckIns.id, existing.id),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .returning();

  if (!updated) {
    // Lost a race against another closer (e.g. autoCheckOutForSessionEnd
    // closing this row with reason="session_close"). Re-read the now-closed
    // row and return it without emitting a second audit — the winning closer
    // already wrote one.
    const [closed] = await db
      .select()
      .from(clinicalCheckIns)
      .where(eq(clinicalCheckIns.id, existing.id))
      .limit(1);
    if (!closed) {
      throw new ClinicalCheckInError(
        404,
        "NOT_CHECKED_IN",
        "User has no active clinical check-in",
      );
    }
    return closed;
  }

  // Fire-and-forget; if a future refactor wraps this path in db.transaction(...),
  // thread the tx through to logAudit({ ..., tx }) so the audit row commits atomically.
  logAudit({
    clinicId: actor.clinicId,
    actionType: "clinical_check_out",
    performedBy: actor.userId,
    performedByEmail: actor.email,
    targetId: updated.id,
    targetType: "clinical_check_in",
    metadata: {
      checkInId: updated.id,
      clinicId: actor.clinicId,
      userId: actor.userId,
      operationalRole: updated.operationalRole,
      source: reason,
    },
  });

  return updated;
}

export type ForceCloseAdmin = {
  id: string;
  email: string;
  role: string;
  clinicId: string;
};

export type ForceCloseResult = {
  row: ClinicalCheckIn;
  alreadyClosed: boolean;
};

/**
 * Admin-only recovery: force-close a specific stuck clinical check-in row.
 *
 * Tenant-scoped: row must belong to `admin.clinicId`. Cross-clinic IDs surface as 404.
 * Race-safe: a single optimistic UPDATE ... WHERE checked_out_at IS NULL guards against
 * concurrent closers (self / session_close / other admins). When the UPDATE no-ops,
 * we re-SELECT to distinguish "not found" (→ 404) from "already closed" (→ idempotent
 * 200 with alreadyClosed=true).
 *
 * Audits:
 *  - successful close: actionType="clinical_check_out", metadata.source="admin_force"
 *  - idempotent no-op: actionType="clinical_check_out", metadata.source="admin_force",
 *                      metadata.outcome="noop_already_closed", metadata.existingSource=<prior>
 *  - 404: no audit
 */
export async function forceCloseCheckIn(args: {
  admin: ForceCloseAdmin;
  targetCheckInId: string;
  reason?: string | null;
  requestId?: string | null;
}): Promise<ForceCloseResult> {
  const { admin, targetCheckInId, reason, requestId } = args;
  const adminReason =
    typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
  const reqId = typeof requestId === "string" && requestId.length > 0 ? requestId : null;

  const checkedOutAt = new Date();
  const [updated] = await db
    .update(clinicalCheckIns)
    .set({ checkedOutAt, checkOutReason: "admin_force" })
    .where(
      and(
        eq(clinicalCheckIns.id, targetCheckInId),
        eq(clinicalCheckIns.clinicId, admin.clinicId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .returning();

  if (updated) {
    // Fire-and-forget; mirrors closeCheckIn / autoCheckOutForSessionEnd.
    logAudit({
      clinicId: admin.clinicId,
      actionType: "clinical_check_out",
      performedBy: admin.id,
      performedByEmail: admin.email,
      actorRole: admin.role,
      targetId: updated.id,
      targetType: "clinical_check_in",
      metadata: {
        checkInId: updated.id,
        clinicId: updated.clinicId,
        userId: updated.userId,
        operationalRole: updated.operationalRole,
        source: "admin_force",
        adminReason,
        requestId: reqId,
      },
    });
    return { row: updated, alreadyClosed: false };
  }

  const [existing] = await db
    .select()
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.id, targetCheckInId),
        eq(clinicalCheckIns.clinicId, admin.clinicId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new ClinicalCheckInError(
      404,
      "NOT_FOUND",
      "Clinical check-in not found in this clinic",
      "CHECK_IN_NOT_FOUND",
    );
  }

  logAudit({
    clinicId: admin.clinicId,
    actionType: "clinical_check_out",
    performedBy: admin.id,
    performedByEmail: admin.email,
    actorRole: admin.role,
    targetId: existing.id,
    targetType: "clinical_check_in",
    metadata: {
      checkInId: existing.id,
      clinicId: existing.clinicId,
      userId: existing.userId,
      operationalRole: existing.operationalRole,
      source: "admin_force",
      outcome: "noop_already_closed",
      existingSource: existing.checkOutReason,
      adminReason,
      requestId: reqId,
    },
  });

  return { row: existing, alreadyClosed: true };
}

export async function autoCheckOutForSessionEnd(args: {
  clinicId: string;
  endedAt: Date;
  performedBy: { id: string; email: string; role: string };
}): Promise<{ closedCount: number }> {
  const { clinicId, endedAt, performedBy } = args;

  const closed = await db
    .update(clinicalCheckIns)
    .set({ checkedOutAt: endedAt, checkOutReason: "session_close" })
    .where(
      and(
        eq(clinicalCheckIns.clinicId, clinicId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .returning();

  for (const row of closed) {
    // Fire-and-forget; if a future refactor wraps this path in db.transaction(...),
    // thread the tx through to logAudit({ ..., tx }) so the audit row commits atomically.
    logAudit({
      clinicId,
      actionType: "clinical_check_out",
      performedBy: performedBy.id,
      performedByEmail: performedBy.email,
      actorRole: performedBy.role,
      targetId: row.id,
      targetType: "clinical_check_in",
      metadata: {
        checkInId: row.id,
        clinicId,
        userId: row.userId,
        operationalRole: row.operationalRole,
        source: "session_close",
      },
    });
  }

  return { closedCount: closed.length };
}
