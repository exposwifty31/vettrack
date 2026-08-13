import { randomUUID } from "crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import {
  clinicalCheckIns,
  db,
  users,
  type ClinicalCheckIn,
} from "../db.js";
import { logAudit, type AuditDbExecutor } from "../lib/audit.js";
import { invalidateForUser } from "../lib/authority-cache.js";
import {
  DOCTOR_TEAM_ROLES,
  isDoctorTeamRole,
  type DoctorTeamRole,
} from "../../shared/doctor-teams.js";

export const OPERATIONAL_ROLES = [
  "admission",
  "ward",
  "senior_lead",
  "night_admission_only",
  "night_senior_no_admission",
  "icu",
  "internal_medicine",
] as const;
export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

const OPERATIONAL_ROLE_SET = new Set<string>(OPERATIONAL_ROLES);

/**
 * Doctor shift gate (spec 2026-08-13): the three doctor team roles are
 * universally allowed for vets — no `allowedOperationalRoles` membership
 * required (zero admin upkeep). Legacy roles keep allowlist semantics.
 * Canonical definition lives in shared/doctor-teams.ts (also consumed by the
 * authority enforcement layer); re-exported here for existing consumers.
 */
export { DOCTOR_TEAM_ROLES, isDoctorTeamRole };
export type { DoctorTeamRole };

export type CheckInSource = "self" | "session_close" | "admin_force";

/**
 * Immutable origin of a check-in row (`check_in_source`, migration 184),
 * computed ONCE at insert. The doctor expiry sweep targets 'doctor_gate'
 * rows only; 'legacy' rows are untouchable. Persisted because inferring
 * origin from the live `allowedOperationalRoles` drifts when an admin later
 * edits the allowlist.
 */
export type CheckInOrigin = "doctor_gate" | "legacy";

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
  isSenior?: unknown;
  replaceSenior?: unknown;
  idempotencyKey?: string | null;
};

export type CheckInResult = { row: ClinicalCheckIn; replayed: boolean };

export class ClinicalCheckInError extends Error {
  status: number;
  code: string;
  reason: string;
  /** Optional structured context for the client (e.g. `{ currentSeniorName }` on SENIOR_ALREADY_ASSIGNED). */
  metadata?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    reason: string = code,
    metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.metadata = metadata;
    this.name = "ClinicalCheckInError";
  }
}

const REPLAY_WINDOW_MS = 60_000;

/** Partial unique index backing the one-open-senior-per-team invariant (migration 183). */
const OPEN_SENIOR_PER_TEAM_INDEX = "ux_vt_clinical_check_ins_open_senior_per_team";

function isUniqueConstraintViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const o = err as { code?: string; cause?: { code?: string } };
  return o.code === "23505" || o.cause?.code === "23505";
}

/** Constraint/index name carried by a 23505, wherever pg/drizzle put it. */
function uniqueViolationConstraint(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const o = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  if (o.code === "23505" && typeof o.constraint === "string") return o.constraint;
  if (o.cause?.code === "23505" && typeof o.cause.constraint === "string") {
    return o.cause.constraint;
  }
  return null;
}

async function seniorAlreadyAssignedFromRace(
  actor: CheckInActor,
  operationalRole: unknown,
): Promise<ClinicalCheckInError> {
  // The partial unique index caught a concurrent senior claim that the
  // check-then-act SELECT could not see. Same contract as the SELECT-based
  // 409 — the racer's transaction has committed by the time our own rolled
  // back, so re-query the winning senior to name them in the replacement
  // dialog; null only when the re-query finds none (or fails).
  let currentSeniorName: string | null = null;
  if (typeof operationalRole === "string") {
    try {
      const [winner] = await db
        .select({ name: users.name, displayName: users.displayName })
        .from(clinicalCheckIns)
        .leftJoin(
          users,
          and(eq(clinicalCheckIns.userId, users.id), eq(users.clinicId, actor.clinicId)),
        )
        .where(
          and(
            eq(clinicalCheckIns.clinicId, actor.clinicId),
            eq(clinicalCheckIns.operationalRole, operationalRole),
            eq(clinicalCheckIns.isSenior, true),
            isNull(clinicalCheckIns.checkedOutAt),
            ne(clinicalCheckIns.userId, actor.userId),
          ),
        )
        .limit(1);
      currentSeniorName =
        (winner?.displayName && winner.displayName.length > 0
          ? winner.displayName
          : winner?.name) ?? null;
    } catch {
      // Best-effort name resolution — the 409 contract must not depend on it.
    }
  }
  return new ClinicalCheckInError(
    409,
    "SENIOR_ALREADY_ASSIGNED",
    "The team already has an open senior check-in",
    "SENIOR_ALREADY_ASSIGNED",
    { currentSeniorName },
  );
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

/**
 * Query executor accepted by the shared validation core: either the global
 * `db` handle (plain `openCheckIn`) or a transaction (`switchOperationalRole`).
 */
type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

type ValidatedCheckIn = {
  storedOperationalRole: OperationalRole | null;
  wantsSenior: boolean;
  checkInSource: CheckInOrigin;
};

/**
 * Shared validation core for `openCheckIn` and `switchOperationalRole`.
 * Narrows the actor role, applies the operational-role rules (doctor team
 * roles universally allowed for vets; legacy roles keep the allowlist path),
 * and resolves the senior semantics — including demoting an existing open
 * senior when `replaceSenior=true`.
 *
 * BOTH callers run this inside a `db.transaction` and pass the tx as `dbc`
 * AND `txForAudit`: the demote UPDATE and the `doctor_senior_replaced` audit
 * row commit or roll back atomically with the caller's own insert. Never
 * call this with the global `db` handle when a failable write follows — an
 * auto-committed demote with a failed insert leaves the team with no senior.
 */
async function validateAndBuildRow(
  input: CheckInInput,
  dbc: DbExecutor,
  txForAudit?: AuditDbExecutor,
): Promise<ValidatedCheckIn> {
  const { actor } = input;

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
  // Immutable origin, classified ONCE here (insert time) — never re-derived
  // from the live allowlist afterwards (migration 184).
  let checkInSource: CheckInOrigin = "legacy";

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
      if (!isDoctorTeamRole(operationalRoleInput)) {
        // Legacy roles keep the pre-existing allowlist path byte-for-byte;
        // doctor team roles are universally allowed for vets (no allowlist).
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
      } else if (operationalRoleInput === "admission") {
        // 'admission' is ambiguous: it pre-exists as a legacy allowlist role.
        // A row opened by a vet allowlisted for it AT INSERT TIME is
        // classified 'legacy' (pre-feature semantics could have produced it,
        // so the expiry sweep must never touch it); everyone else reaches
        // 'admission' only via the doctor gate.
        const allowed = await getAllowedOperationalRoles(actor.userId, actor.clinicId);
        checkInSource = allowed.includes("admission") ? "legacy" : "doctor_gate";
      } else {
        // icu / internal_medicine did not exist before the doctor gate.
        checkInSource = "doctor_gate";
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

  // Doctor shift gate: server-validated senior semantics. `isSenior=true`
  // requires a doctor team role AND the admin-set `seniorDoctorEligible`
  // flag; at most one open senior per team, replaced only with explicit
  // `replaceSenior=true` (the previous row stays open, demoted).
  const wantsSenior = input.isSenior === true;
  if (wantsSenior) {
    if (storedOperationalRole === null || !isDoctorTeamRole(storedOperationalRole)) {
      throw new ClinicalCheckInError(
        422,
        "SENIOR_REQUIRES_TEAM_ROLE",
        "isSenior requires a doctor team operational role",
      );
    }
    const [u] = await dbc
      .select({ eligible: users.seniorDoctorEligible })
      .from(users)
      .where(and(eq(users.id, actor.userId), eq(users.clinicId, actor.clinicId)))
      .limit(1);
    if (!u?.eligible) {
      throw new ClinicalCheckInError(
        403,
        "SENIOR_NOT_ELIGIBLE",
        "User is not eligible to be a senior doctor",
      );
    }
    // Excludes the actor's own open row: a retried request (idempotent
    // replay) or a same-team re-submit via /switch must never treat the
    // caller's own senior row as "the existing senior" — that self-conflict
    // either 409s the caller against themselves or demotes their own row.
    const [existing] = await dbc
      .select({
        id: clinicalCheckIns.id,
        userId: clinicalCheckIns.userId,
        name: users.name,
        displayName: users.displayName,
      })
      .from(clinicalCheckIns)
      .leftJoin(users, eq(clinicalCheckIns.userId, users.id))
      .where(
        and(
          eq(clinicalCheckIns.clinicId, actor.clinicId),
          eq(clinicalCheckIns.operationalRole, storedOperationalRole),
          eq(clinicalCheckIns.isSenior, true),
          isNull(clinicalCheckIns.checkedOutAt),
          ne(clinicalCheckIns.userId, actor.userId),
        ),
      )
      .limit(1);
    if (existing && input.replaceSenior !== true) {
      const currentSeniorName =
        (existing.displayName && existing.displayName.length > 0
          ? existing.displayName
          : existing.name) ?? null;
      throw new ClinicalCheckInError(
        409,
        "SENIOR_ALREADY_ASSIGNED",
        "The team already has an open senior check-in",
        "SENIOR_ALREADY_ASSIGNED",
        { currentSeniorName },
      );
    }
    if (existing) {
      await dbc
        .update(clinicalCheckIns)
        .set({ isSenior: false })
        .where(
          and(
            eq(clinicalCheckIns.id, existing.id),
            eq(clinicalCheckIns.clinicId, actor.clinicId),
          ),
        );
      const replaceAudit = {
        clinicId: actor.clinicId,
        actionType: "doctor_senior_replaced" as const,
        performedBy: actor.userId,
        performedByEmail: actor.email,
        targetId: existing.id,
        targetType: "clinical_check_in",
        metadata: {
          team: storedOperationalRole,
          previousCheckInId: existing.id,
          previousUserId: existing.userId,
        },
      };
      if (txForAudit) {
        await logAudit({ ...replaceAudit, tx: txForAudit });
      } else {
        // Fire-and-forget, mirrors the check-in audit in openCheckIn.
        logAudit(replaceAudit);
      }
      invalidateForUser(actor.clinicId, existing.userId);
    }
  }

  return { storedOperationalRole, wantsSenior, checkInSource };
}

export async function openCheckIn(input: CheckInInput): Promise<CheckInResult> {
  const { actor } = input;
  const idempotencyKey = input.idempotencyKey ?? null;

  try {
    // One transaction around validate → (maybe demote) → insert → audit:
    // a failed insert (e.g. the open-per-user unique index) rolls back the
    // replace-senior demote and its audit row instead of leaving the team
    // with no senior and a false "replaced" audit trail.
    const inserted = await db.transaction(async (tx) => {
      const { storedOperationalRole, wantsSenior, checkInSource } =
        await validateAndBuildRow(input, tx, tx);

      const [row] = await tx
        .insert(clinicalCheckIns)
        .values({
          id: randomUUID(),
          clinicId: actor.clinicId,
          userId: actor.userId,
          operationalRole: storedOperationalRole,
          isSenior: wantsSenior,
          clinicalRoleAtCheckIn: actor.role,
          activeShiftId: null,
          shiftSessionId: null,
          clientId: idempotencyKey,
          checkInSource,
        })
        .returning();

      await logAudit({
        clinicId: actor.clinicId,
        actionType: "clinical_check_in",
        performedBy: actor.userId,
        performedByEmail: actor.email,
        targetId: row.id,
        targetType: "clinical_check_in",
        metadata: {
          checkInId: row.id,
          clinicId: actor.clinicId,
          userId: actor.userId,
          operationalRole: storedOperationalRole,
          source: "self",
        },
        tx,
      });

      return row;
    });

    invalidateForUser(actor.clinicId, actor.userId);
    return { row: inserted, replayed: false };
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;

    if (uniqueViolationConstraint(err) === OPEN_SENIOR_PER_TEAM_INDEX) {
      // Concurrent senior claim on the same team (DB backstop for the
      // check-then-act SELECT) — not an "already checked in" condition.
      throw await seniorAlreadyAssignedFromRace(actor, input.operationalRole);
    }

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

/**
 * Atomic role switch (doctor shift gate): close the actor's open check-in
 * with `checkOutReason='role_switch'` and insert the new one inside a single
 * transaction, so the board never observes a gap where the doctor has no
 * open check-in. With no open row it degrades to a plain open. The new role
 * goes through the exact same validation path as `openCheckIn` (team-role
 * bypass, allowlist for legacy roles, server-validated senior semantics).
 */
export async function switchOperationalRole(
  input: CheckInInput,
): Promise<CheckInResult> {
  const { actor } = input;

  try {
    const inserted = await db.transaction(async (tx) => {
      const { storedOperationalRole, wantsSenior, checkInSource } =
        await validateAndBuildRow(input, tx, tx);

      const now = new Date();
      const [closedRow] = await tx
        .update(clinicalCheckIns)
        .set({ checkedOutAt: now, checkOutReason: "role_switch" })
        .where(
          and(
            eq(clinicalCheckIns.clinicId, actor.clinicId),
            eq(clinicalCheckIns.userId, actor.userId),
            isNull(clinicalCheckIns.checkedOutAt),
          ),
        )
        .returning();

      const [insertedRow] = await tx
        .insert(clinicalCheckIns)
        .values({
          id: randomUUID(),
          clinicId: actor.clinicId,
          userId: actor.userId,
          operationalRole: storedOperationalRole,
          isSenior: wantsSenior,
          clinicalRoleAtCheckIn: actor.role,
          activeShiftId: null,
          shiftSessionId: null,
          clientId: null,
          checkInSource,
        })
        .returning();

      if (closedRow) {
        await logAudit({
          clinicId: actor.clinicId,
          actionType: "clinical_check_out",
          performedBy: actor.userId,
          performedByEmail: actor.email,
          targetId: closedRow.id,
          targetType: "clinical_check_in",
          metadata: {
            checkInId: closedRow.id,
            clinicId: actor.clinicId,
            userId: actor.userId,
            operationalRole: closedRow.operationalRole,
            source: "role_switch",
          },
          tx,
        });
      }
      await logAudit({
        clinicId: actor.clinicId,
        actionType: "clinical_check_in",
        performedBy: actor.userId,
        performedByEmail: actor.email,
        targetId: insertedRow.id,
        targetType: "clinical_check_in",
        metadata: {
          checkInId: insertedRow.id,
          clinicId: actor.clinicId,
          userId: actor.userId,
          operationalRole: storedOperationalRole,
          source: "role_switch",
        },
        tx,
      });

      return insertedRow;
    });

    invalidateForUser(actor.clinicId, actor.userId);
    return { row: inserted, replayed: false };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      if (uniqueViolationConstraint(err) === OPEN_SENIOR_PER_TEAM_INDEX) {
        // Concurrent senior claim on the target team — the transaction
        // rolled back, so the previous check-in (if any) is still open.
        throw await seniorAlreadyAssignedFromRace(actor, input.operationalRole);
      }
      // Lost a race against a concurrent open — the transaction rolled back,
      // so the previous check-in (if any) is still open.
      throw new ClinicalCheckInError(
        409,
        "ALREADY_CHECKED_IN",
        "User already has an active clinical check-in",
      );
    }
    throw err;
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
    invalidateForUser(actor.clinicId, actor.userId);
    return closed;
  }

  invalidateForUser(actor.clinicId, actor.userId);

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
    invalidateForUser(clinicId, row.userId);
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
