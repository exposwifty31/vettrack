import type { RequestHandler } from "express";
import { deleteOwnAccount, AccountDeletionProtectedError, SoleClinicAdminError } from "../../../services/account-deletion.service.js";
import { invalidateForUser } from "../../../lib/authority-cache.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/**
 * DELETE /api/users/delete-account
 *
 * Self-service in-app account deletion (App Store Guideline 5.1.1(v)). Revokes
 * the user's Apple token at Apple, erases their personal data (hard delete when
 * referential integrity allows, otherwise an anonymized tombstone), and deletes
 * the Clerk user. The client signs out and redirects on success.
 *
 * Always operates on the CALLER's own account — never an arbitrary id.
 *
 * Uses requireAuthAny (not requireAuth) so a freshly-created status='pending'
 * account can still exercise its Guideline 5.1.1(v) right to self-delete — the
 * strict requireAuth gate would 403 (ACCOUNT_PENDING_APPROVAL) before this
 * handler runs. Self-scoped by construction (deleteOwnAccount reads req.authUser
 * only), and the demo/reviewer protected-account 403 stays enforced in the
 * service layer.
 */
export const deleteUserAccountHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const actor = req.authUser!;
    invalidateForUser(actor.clinicId, actor.id);
    const result = await deleteOwnAccount(actor);

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SoleClinicAdminError) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "SOLE_CLINIC_ADMIN",
          message: "You are the only member of your clinic's organization; transfer or remove the clinic before deleting this account.",
          requestId,
        }),
      );
    }
    if (err instanceof AccountDeletionProtectedError) {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "ACCOUNT_DELETION_PROTECTED",
          message: "This account cannot be deleted through the app.",
          requestId,
        }),
      );
    }
    console.error("users:delete-account", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ACCOUNT_DELETION_FAILED",
        message: "Deletion failed. Please try again.",
        requestId,
      }),
    );
  }
};
