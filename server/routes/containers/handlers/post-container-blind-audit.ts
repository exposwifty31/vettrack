import type { RequestHandler } from "express";
import { apiError, resolveRequestId } from "../../../lib/route-utils.js";

/** POST /api/containers/:id/blind-audit — legacy endpoint, disabled. Use restock sessions. */
export const postContainerBlindAuditHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  return res.status(409).json(
    apiError({
      code: "LEGACY_RESTOCK_DISABLED",
      reason: "LEGACY_RESTOCK_DISABLED",
      message: "Legacy blind-audit endpoint is disabled. Use restock sessions.",
      requestId,
    }),
  );
};
