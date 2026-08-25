import type { RequestHandler } from "express";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";

/**
 * POST /api/code-blue/sessions/:id/manual-billing
 * Tombstone: manual billing was removed with the billing schema. Retained so
 * existing clients receive a stable 410 instead of a 404.
 */
export const postSessionsIdManualBillingHandler: RequestHandler = (req, res) => {
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
