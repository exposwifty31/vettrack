/**
 * Self-service account deletion (App Store Guideline 5.1.1(v)).
 *
 * Orchestrates the full delete path for a user deleting their OWN account:
 *   1. Revoke the stored Sign in with Apple token at Apple (non-fatal).
 *   2. Erase the user's personal data — hard-delete the row when referential
 *      integrity allows, otherwise anonymize + soft-delete as a tombstone
 *      (many vt_users FKs are ON DELETE RESTRICT, so a hard delete can fail for
 *      users with operational history; either way the PII is gone).
 *   3. Delete the Clerk user so the auth identity is removed and the reviewer's
 *      re-sign-in test provisions a brand-new account (non-fatal).
 *
 * Ordering follows Apple TN3194: revoke/erase first, then ensure the client is
 * unauthenticated. Apple revocation failures must NOT block the user's right to
 * deletion, so they are logged and the flow continues.
 */
import { clerkClient } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, users, appleOauthTokens } from "../db.js";
import { decryptConfigValue } from "../lib/config-crypto.js";
import { isAppleRevocationConfigured, revokeAppleToken } from "../lib/apple-auth.js";
import { logAudit } from "../lib/audit.js";
import type { AuthUser } from "../middleware/auth.js";

const PG_FK_VIOLATION = "23503";

export type AppleRevocationOutcome = "revoked" | "failed" | "skipped";
export type DbDeletionOutcome = "hard_deleted" | "anonymized";

export interface AccountDeletionResult {
  appleRevocation: AppleRevocationOutcome;
  dbOutcome: DbDeletionOutcome;
  clerkDeleted: boolean;
}

function isFkViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === PG_FK_VIOLATION
  );
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

/** Delete the Clerk user. Skipped in dev-bypass / when Clerk is not configured. */
async function deleteClerkUser(clerkId: string): Promise<boolean> {
  if (!process.env.CLERK_SECRET_KEY?.trim()) return false;
  // Dev-bypass identities are synthetic and not present in Clerk.
  if (!clerkId.trim() || clerkId.startsWith("dev-")) return false;
  try {
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
  const appleRevocation = await revokeStoredAppleToken(user.clinicId, user.id);
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
    metadata: { appleRevocation, dbOutcome, clerkDeleted },
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

  return { appleRevocation, dbOutcome, clerkDeleted };
}
