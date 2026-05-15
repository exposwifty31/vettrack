/**
 * Phase 3 PR 3.2: Exact-match task-ownership resolver.
 *
 * Maps a historical `metadata.acknowledgedBy` string from `vt_appointments`
 * to a typed `vt_users.id` reference. Only **two** auto-resolve tiers are
 * permitted; everything else is queued for manual admin confirmation.
 *
 * Tier 1 — `auto_exact_id`: same-clinic active user whose `vt_users.id`
 *          matches the raw string exactly.
 * Tier 2 — `auto_exact_clerk_id`: same-clinic active user whose
 *          `vt_users.clerk_id` matches the raw string exactly.
 *
 * Hard invariants (enforced here and asserted by tests):
 *  - clinic-scoped: a match in a different clinic NEVER auto-resolves.
 *  - active-only: `status = 'active' AND deleted_at IS NULL`. Blocked or
 *    soft-deleted users NEVER auto-resolve.
 *  - no fuzzy / edit-distance / similarity matching.
 *  - no email or display-name matching (the inventory in §7.1 of the
 *    Phase 3 plan proved the column never contains those formats).
 *
 * Pure function: no side effects, no metrics, no audit. The caller (the
 * backfill worker) is responsible for emitting counters and queue inserts
 * based on the returned `Resolution`.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { db, users } from "../db.js";

export const MATCHER_VERSION = "3.2.0";

export type ResolutionSource =
  | "auto_exact_id"
  | "auto_exact_clerk_id"
  | "queued"
  | "skipped";

export type QueueReason =
  | "NO_CANDIDATE"
  | "CROSS_CLINIC_REJECTED"
  | "BLOCKED_USER"
  | "DELETED_USER"
  | "AMBIGUOUS_MATCH"
  | "EMPTY_RAW_VALUE";

export interface ResolutionAutoExactId {
  source: "auto_exact_id";
  userId: string;
}

export interface ResolutionAutoExactClerkId {
  source: "auto_exact_clerk_id";
  userId: string;
}

export interface ResolutionQueued {
  source: "queued";
  reason: Exclude<QueueReason, "EMPTY_RAW_VALUE">;
  candidateUserIds: string[];
}

export interface ResolutionSkipped {
  source: "skipped";
  reason: "EMPTY_RAW_VALUE";
}

export type Resolution =
  | ResolutionAutoExactId
  | ResolutionAutoExactClerkId
  | ResolutionQueued
  | ResolutionSkipped;

interface UserLookupRow {
  id: string;
  clerkId: string;
  clinicId: string;
  status: string;
  deletedAt: Date | null;
}

/**
 * Look up users (across all clinics) whose `id` or `clerk_id` equals the raw
 * value. We need cross-clinic visibility solely to detect the
 * `CROSS_CLINIC_REJECTED` case — auto-resolve still requires same-clinic.
 */
async function findCandidates(rawAcknowledgedBy: string): Promise<UserLookupRow[]> {
  return db
    .select({
      id: users.id,
      clerkId: users.clerkId,
      clinicId: users.clinicId,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(or(eq(users.id, rawAcknowledgedBy), eq(users.clerkId, rawAcknowledgedBy)));
}

/**
 * For tests and worker fast paths that want to inject candidates rather than
 * hit the database. The default implementation queries `vt_users`.
 */
export type CandidateLookup = (rawAcknowledgedBy: string) => Promise<UserLookupRow[]>;

export interface ResolveOwnershipOptions {
  lookup?: CandidateLookup;
}

export async function resolveOwnership(
  clinicId: string,
  rawAcknowledgedBy: string | null | undefined,
  options: ResolveOwnershipOptions = {},
): Promise<Resolution> {
  const trimmed = (rawAcknowledgedBy ?? "").trim();
  if (trimmed.length === 0) {
    return { source: "skipped", reason: "EMPTY_RAW_VALUE" };
  }

  const lookup = options.lookup ?? findCandidates;
  const candidates = await lookup(trimmed);

  // No candidate anywhere in the database (any clinic).
  if (candidates.length === 0) {
    return { source: "queued", reason: "NO_CANDIDATE", candidateUserIds: [] };
  }

  const sameClinic = candidates.filter((c) => c.clinicId === clinicId);

  // The only candidates are in other clinics — never auto-resolve.
  if (sameClinic.length === 0) {
    return {
      source: "queued",
      reason: "CROSS_CLINIC_REJECTED",
      candidateUserIds: [],
    };
  }

  // PK on `id` and UNIQUE on `clerk_id` make >1 same-clinic match impossible
  // under normal invariants, but defend against it explicitly.
  if (sameClinic.length > 1) {
    return {
      source: "queued",
      reason: "AMBIGUOUS_MATCH",
      candidateUserIds: sameClinic.map((c) => c.id),
    };
  }

  const candidate = sameClinic[0];

  // Soft-deleted user — never auto-resolve, but surface the candidate so an
  // admin can decide via the manual confirm path.
  if (candidate.deletedAt !== null) {
    return {
      source: "queued",
      reason: "DELETED_USER",
      candidateUserIds: [candidate.id],
    };
  }

  // Non-active user (blocked / pending / anything other than 'active') —
  // never auto-resolve.
  if (candidate.status !== "active") {
    return {
      source: "queued",
      reason: "BLOCKED_USER",
      candidateUserIds: [candidate.id],
    };
  }

  // Auto-resolve. Prefer `id` match when both id and clerk_id happen to equal
  // the raw value (defensive — extremely unlikely given PK vs UNIQUE columns).
  if (candidate.id === trimmed) {
    return { source: "auto_exact_id", userId: candidate.id };
  }
  if (candidate.clerkId === trimmed) {
    return { source: "auto_exact_clerk_id", userId: candidate.id };
  }

  // Should be unreachable: candidate was returned by a query whose WHERE
  // clause was `id = $raw OR clerk_id = $raw`. If neither matched here, the
  // database returned an unexpected row; queue defensively.
  return {
    source: "queued",
    reason: "AMBIGUOUS_MATCH",
    candidateUserIds: [candidate.id],
  };
}

/**
 * Re-validate a candidate at admin-confirmation time. Per §8.4 the admin's
 * `confirmedUserId` must still satisfy the active-same-clinic predicate
 * regardless of what was true at enqueue time. Returns null when valid;
 * returns the offending reason otherwise.
 */
export type ConfirmationValidationFailure = "NOT_FOUND" | "CROSS_CLINIC" | "DELETED" | "NOT_ACTIVE";

export async function validateConfirmationCandidate(
  clinicId: string,
  candidateUserId: string,
): Promise<ConfirmationValidationFailure | null> {
  const rows = await db
    .select({
      id: users.id,
      clinicId: users.clinicId,
      status: users.status,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, candidateUserId))
    .limit(1);
  if (rows.length === 0) return "NOT_FOUND";
  const u = rows[0];
  if (u.clinicId !== clinicId) return "CROSS_CLINIC";
  if (u.deletedAt !== null) return "DELETED";
  if (u.status !== "active") return "NOT_ACTIVE";
  return null;
}

// Silences unused-import warnings when the file is read by tooling without
// invoking the lookup; `and` and `isNull` are kept here so the worker can
// import combinator helpers from the same module if it chooses.
export const __resolverHelpers = { and, isNull };
