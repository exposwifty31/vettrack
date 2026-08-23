import type { RequestHandler } from "express";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

/**
 * POST /api/code-blue/sessions/:id/manual-billing
 * Creates a manual billing entry for an unbilled dispense. Admin only.
 */
export const postSessionsIdManualBillingHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  return res.status(410).json(
    apiError({
      code: "BILLING_REMOVED",
      reason: "BILLING_SCHEMA_REMOVED",
      message: "Manual billing is no longer available.",
      requestId,
    }),
  );
};
