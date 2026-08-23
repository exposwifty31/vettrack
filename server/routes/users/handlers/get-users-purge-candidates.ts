import type { RequestHandler } from "express";
import { countPurgeCandidates, PURGE_AFTER_DAYS } from "../../../lib/cleanup-scheduler.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/**
 * GET /api/users/purge-candidates
 * Returns count of soft-deleted users eligible for permanent purge.
 * Admin only — informational endpoint before committing to purge.
 */
export const getUsersPurgeCandidatesHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const count = await countPurgeCandidates();
    res.json({ count, purgeAfterDays: PURGE_AFTER_DAYS });
  } catch (err) {
    console.error("users:purge-candidates", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PURGE_CANDIDATES_FAILED",
        message: "Failed to count purge candidates",
        requestId,
      }),
    );
  }
};
