import type { RequestHandler } from "express";
import { purgeDeletedUsers, PURGE_AFTER_DAYS } from "../../../lib/cleanup-scheduler.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/**
 * POST /api/users/purge-deleted
 * Permanently hard-deletes soft-deleted users that have been deleted for
 * longer than PURGE_AFTER_DAYS. Requires admin role. Logged to audit trail.
 * This is the ONLY way to permanently remove users — automatic cleanup
 * schedulers do not perform hard deletes.
 */
export const postUsersPurgeDeletedHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const actor = req.authUser!;
    const { purged } = await purgeDeletedUsers({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      clinicId,
    });
    return res.json({ ok: true, purged, purgeAfterDays: PURGE_AFTER_DAYS });
  } catch (err) {
    console.error("users:purge-deleted", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PURGE_DELETED_FAILED",
        message: "Failed to purge deleted users",
        requestId,
      }),
    );
  }
};
