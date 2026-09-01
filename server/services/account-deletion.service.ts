/**
 * Self-service account deletion (App Store Guideline 5.1.1(v)).
 *
 * Orchestrates the full delete path for a user deleting their OWN account:
 *   1. Revoke the stored Sign in with Apple token at Apple (non-fatal).
 *   2. Delete the uploaded avatar OBJECT from storage (non-fatal), BEFORE the
 *      row that holds its key is erased. Nulling the column is not deletion:
 *      the bucket is private, so the image became unreachable and stayed.
 *   3. Erase the user's personal data — hard-delete the row when referential
 *      integrity allows, otherwise anonymize + soft-delete as a tombstone
 *      (many vt_users FKs are ON DELETE RESTRICT, so a hard delete can fail for
 *      users with operational history; either way the PII is gone).
 *   4. Delete the Clerk user so the auth identity is removed and the reviewer's
 *      re-sign-in test provisions a brand-new account (non-fatal).
 *
 * Ordering follows Apple TN3194: revoke/erase first, then ensure the client is
 * unauthenticated. Apple revocation failures must NOT block the user's right to
 * deletion, so they are logged and the flow continues.
 */
import { clerkClient } from "@clerk/express";
import { inArray } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { clinics, db, users, appleOauthTokens } from "../db.js";
import { decryptConfigValue } from "../lib/config-crypto.js";
import { isAppleRevocationConfigured, revokeAppleToken } from "../lib/apple-auth.js";
import { logAudit } from "../lib/audit.js";
import { deleteStoredObject, type ObjectDeletionOutcome } from "../lib/object-storage.js";
import type { AuthUser } from "../middleware/auth.js";

const PG_FK_VIOLATION = "23503";

/** Demo / App Review accounts that must not self-delete through the in-app flow. */
const DEFAULT_PROTECTED_EMAILS = ["reviewer@vettrack.uk"];

export class AccountDeletionProtectedError extends Error {
  constructor() {
    super("ACCOUNT_DELETION_PROTECTED");
    this.name = "AccountDeletionProtectedError";
  }
}

function protectedDeletionEmails(): string[] {
  const fromEnv = (process.env.ACCOUNT_DELETION_PROTECTED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // The built-in reviewer default is ALWAYS protected — the env var ADDS to the
  // list rather than replacing it, so a Railway override can never accidentally
  // make the App Review demo account self-deletable mid-review.
  return Array.from(new Set([...DEFAULT_PROTECTED_EMAILS, ...fromEnv]));
}

/** True when the email is blocked from self-service deletion (demo / review accounts). */
export function isAccountDeletionProtected(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return protectedDeletionEmails().includes(normalized);
}

export type AppleRevocationOutcome = "revoked" | "failed" | "skipped";
export type DbDeletionOutcome = "hard_deleted" | "anonymized";

export interface AccountDeletionResult {
  appleRevocation: AppleRevocationOutcome;
  dbOutcome: DbDeletionOutcome;
  /** Whether the uploaded avatar OBJECT was removed, not just its pointer. */
  avatarObject: ObjectDeletionOutcome;
  clerkDeleted: boolean;
}

function isFkViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === PG_FK_VIOLATION
  );
}

/**
 * Delete the user's uploaded avatar OBJECT from storage. Never throws.
 *
 * Must run BEFORE eraseUserData: both erasure paths drop `avatarUrl` — the hard
 * delete removes the row, the tombstone nulls the column — and the key is the
 * only handle on the object. Read it afterwards and the image is orphaned with
 * nothing left pointing at it.
 *
 * The old behaviour was to null the column and stop, which is not deletion: the
 * bucket is private so the image became unreachable, but it stayed. That is not
 * what a data-deletion declaration on either store claims.
 *
 * Non-fatal, exactly like Apple revocation above: a storage outage must not be
 * able to block a user's Guideline 5.1.1(v) right to delete their account. The
 * outcome is returned and audited so a failure is reconcilable, not invisible.
 */
async function deleteStoredAvatar(clinicId: string, userId: string): Promise<ObjectDeletionOutcome> {
  const [row] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(and(eq(users.clinicId, clinicId), eq(users.id, userId)))
    .limit(1);
  return deleteStoredObject(row?.avatarUrl);
}

/** Revoke the user's Apple token at Apple, if we hold one. Never throws. */
async function revokeStoredAppleToken(clinicId: string, userId: string): Promise<AppleRevocationOutcome> {
  const [row] = await db
    .select({ refreshToken: appleOauthTokens.refreshToken })
    .from(appleOauthTokens)
    .where(and(eq(appleOauthTokens.clinicId, clinicId), eq(appleOauthTokens.userId, userId)))
    .limit(1);

  if (!row) return "skipped";
  if (!isAppleRevocationConfigured()) {
    console.warn("[account-deletion] stored Apple token but revocation not configured", { userId });
    return "skipped";
  }

  try {
    const refreshToken = decryptConfigValue(row.refreshToken);
    await revokeAppleToken(refreshToken, "refresh_token");
    return "revoked";
  } catch (err) {
    // Non-fatal per Apple TN3194: still fulfill the deletion request.
    console.error("[account-deletion] Apple token revoke failed (non-fatal)", {
      userId,
      err: err instanceof Error ? err.message : err,
    });
    return "failed";
  }
}

/** Strip PII and soft-delete the row as an anonymized tombstone. */
async function anonymizeUser(clinicId: string, userId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Cascade only fires on hard delete, so remove the token explicitly here.
    await tx
      .delete(appleOauthTokens)
      .where(and(eq(appleOauthTokens.clinicId, clinicId), eq(appleOauthTokens.userId, userId)));
    await tx
      .update(users)
      .set({
        email: `deleted+${userId}@account-deleted.invalid`,
        name: "",
        displayName: "Deleted account",
        // Strip every remaining PII/verification artifact so the tombstone holds
        // no personal data — the hard-delete path removes these via row deletion.
        vetLicenseNumber: null,
        avatarUrl: null,
        status: "blocked",
        deletedAt: new Date(),
        deletedBy: actorId,
      })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, userId)));
  });
}

/** Hard-delete when FKs allow; fall back to anonymization tombstone otherwise. */
async function eraseUserData(clinicId: string, userId: string, actorId: string): Promise<DbDeletionOutcome> {
  try {
    // Cascades remove the Apple token row and other ON DELETE CASCADE children.
    await db.delete(users).where(and(eq(users.clinicId, clinicId), eq(users.id, userId)));
    return "hard_deleted";
  } catch (err) {
    if (isFkViolation(err)) {
      await anonymizeUser(clinicId, userId, actorId);
      return "anonymized";
    }
    throw err;
  }
}

/** Self-deletion would orphan a REAL clinic the user solely occupies. */
export class SoleClinicAdminError extends Error {
  constructor() {
    super("SOLE_CLINIC_ADMIN");
    this.name = "SoleClinicAdminError";
  }
}

export interface OrgMembershipLite {
  orgId: string;
  membersCount: number;
}

/**
 * Pure planner for pre-deletion Clerk-org hygiene: junk orgs (no vt_clinics
 * row) the user solely occupies are deletable; being the SOLE member of a
 * REAL clinic org blocks self-deletion instead of orphaning the clinic.
 * Multi-member orgs are never touched.
 */
export function planClerkOrgCleanup(
  memberships: OrgMembershipLite[],
  knownClinicIds: Set<string>,
): { deletableOrgIds: string[]; blockingClinicOrgIds: string[] } {
  const deletableOrgIds: string[] = [];
  const blockingClinicOrgIds: string[] = [];
  for (const m of memberships) {
    if (m.membersCount !== 1) continue;
    if (knownClinicIds.has(m.orgId)) blockingClinicOrgIds.push(m.orgId);
    else deletableOrgIds.push(m.orgId);
  }
  return { deletableOrgIds, blockingClinicOrgIds };
}

/**
 * Pre-delete Clerk-org sweep. Non-fatal except for the sole-real-clinic-admin
 * block, which throws BEFORE any DB mutation so the route can 409 cleanly.
 * Skipped entirely in dev-bypass / unconfigured Clerk (same guards as
 * deleteClerkUser).
 */
async function cleanupClerkOrgsBeforeDeletion(clerkId: string): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY?.trim()) return;
  if (!clerkId.trim() || clerkId.startsWith("dev-")) return;
  let memberships: OrgMembershipLite[] = [];
  try {
    const page = await clerkClient.users.getOrganizationMembershipList({ userId: clerkId, limit: 50 });
    memberships = (page.data ?? []).map((m) => ({
      orgId: m.organization?.id ?? "",
      membersCount: m.organization?.membersCount ?? 0,
    })).filter((m) => m.orgId);
  } catch (err) {
    // Non-fatal: without the list we simply skip hygiene (deleteClerkUser is
    // itself non-fatal on failure).
    console.error("[account-deletion] org membership list failed (non-fatal)", {
      err: err instanceof Error ? err.message : err,
    });
    return;
  }
  if (memberships.length === 0) return;
  const ids = memberships.map((m) => m.orgId);
  const known = await db.select({ id: clinics.id }).from(clinics).where(inArray(clinics.id, ids));
  const plan = planClerkOrgCleanup(memberships, new Set(known.map((k) => k.id)));
  if (plan.blockingClinicOrgIds.length > 0) {
    throw new SoleClinicAdminError();
  }
  for (const orgId of plan.deletableOrgIds) {
    try {
      await clerkClient.organizations.deleteOrganization(orgId);
    } catch (err) {
      console.error("[account-deletion] junk-org deletion failed (non-fatal)", {
        orgId,
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}

/**
 * B2 — explicitly delete the Clerk user's external accounts BEFORE the user.
 *
 * The RN app's Apple sign-in goes through Clerk (`oauth_apple`), so the Apple
 * OAuth grant lives on the Clerk user as an external account — not in
 * `vt_apple_oauth_tokens` (that table serves the Capacitor apple-link path,
 * revoked directly above). Clerk documents that DELETING AN EXTERNAL ACCOUNT
 * "also revokes all tokens related to the same OAuth grant"; user deletion
 * removes the accounts but only this path is documented to revoke — so revoke
 * deterministically, then delete the user (TN3194 ordering: revoke first).
 * Best-effort per account, never fatal: the user deletion below proceeds
 * regardless, and the `user.deleted` webhook keeps the systems consistent.
 */
export async function revokeClerkExternalAccounts(clerkId: string): Promise<number> {
  if (!process.env.CLERK_SECRET_KEY?.trim()) return 0;
  if (!clerkId.trim() || clerkId.startsWith("dev-")) return 0;
  let revoked = 0;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    for (const account of clerkUser.externalAccounts ?? []) {
      try {
        await clerkClient.users.deleteUserExternalAccount({
          userId: clerkId,
          externalAccountId: account.id,
        });
        revoked += 1;
      } catch (err) {
        console.error("[account-deletion] external-account revoke failed (non-fatal)", {
          externalAccountId: account.id,
          err: err instanceof Error ? err.message : err,
        });
      }
    }
  } catch (err) {
    console.error("[account-deletion] external-account listing failed (non-fatal)", {
      err: err instanceof Error ? err.message : err,
    });
  }
  return revoked;
}

/** Revocation is additive: a stalled Clerk request must never block the
 * user's Guideline 5.1.1(v) right to delete — after this bound, deletion
 * proceeds and the still-pending revocation settles (or fails, observably)
 * in the background. */
const EXTERNAL_ACCOUNT_REVOCATION_TIMEOUT_MS = 8_000;

/** Delete the Clerk user. Skipped in dev-bypass / when Clerk is not configured.
 * Exported for tests (the planClerkOrgCleanup precedent). */
export async function deleteClerkUser(clerkId: string): Promise<boolean> {
  if (!process.env.CLERK_SECRET_KEY?.trim()) return false;
  // Dev-bypass identities are synthetic and not present in Clerk.
  if (!clerkId.trim() || clerkId.startsWith("dev-")) return false;
  try {
    await Promise.race([
      revokeClerkExternalAccounts(clerkId),
      new Promise<void>((resolve) => setTimeout(resolve, EXTERNAL_ACCOUNT_REVOCATION_TIMEOUT_MS)),
    ]);
    await clerkClient.users.deleteUser(clerkId);
    return true;
  } catch (err) {
    // Non-fatal: the DB row is already gone; the `user.deleted` webhook and the
    // orphan-reconciliation path keep the two systems consistent.
    console.error("[account-deletion] Clerk user deletion failed (non-fatal)", {
      err: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

export async function deleteOwnAccount(user: AuthUser): Promise<AccountDeletionResult> {
  if (isAccountDeletionProtected(user.email)) {
    throw new AccountDeletionProtectedError();
  }

  // Runs BEFORE any DB mutation: a sole-real-clinic-admin block must leave the
  // account fully intact (route maps it to 409 SOLE_CLINIC_ADMIN).
  await cleanupClerkOrgsBeforeDeletion(user.clerkId);

  const appleRevocation = await revokeStoredAppleToken(user.clinicId, user.id);
  // Before eraseUserData, which drops the key this needs.
  const avatarObject = await deleteStoredAvatar(user.clinicId, user.id);
  const dbOutcome = await eraseUserData(user.clinicId, user.id, user.id);
  const clerkDeleted = await deleteClerkUser(user.clerkId);

  logAudit({
    actorRole: String(user.role ?? "").trim().toLowerCase() || null,
    clinicId: user.clinicId,
    actionType: "account_self_deleted",
    performedBy: user.id,
    performedByEmail: user.email,
    targetId: user.id,
    targetType: "user",
    metadata: { appleRevocation, dbOutcome, avatarObject, clerkDeleted },
  });

  if (appleRevocation === "revoked" || appleRevocation === "failed") {
    logAudit({
      actorRole: String(user.role ?? "").trim().toLowerCase() || null,
      clinicId: user.clinicId,
      actionType: appleRevocation === "revoked" ? "apple_token_revoked" : "apple_token_revoke_failed",
      performedBy: user.id,
      performedByEmail: user.email,
      targetId: user.id,
      targetType: "user",
      metadata: { dbOutcome },
    });
  }

  return { appleRevocation, dbOutcome, avatarObject, clerkDeleted };
}
