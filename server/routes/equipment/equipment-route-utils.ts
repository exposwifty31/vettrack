import type { Request, Response } from "express";
import { apiError as apiErrorI18n } from "../../lib/apiError.js";
import { CheckoutPreconditionError } from "../../services/equipment-custody-toggle.service.js";
import { EquipmentWaitlistError } from "../../services/equipment-waitlist.service.js";

export { resolveRequestId, apiError } from "../../lib/route-utils.js";

/**
 * Shared response mapping for the checkout gate errors thrown by
 * evaluateCheckoutV1Preconditions / assertWaitlistCheckoutAllowed — used by
 * every custody-flip route (/scan, /:id/toggle) so a new gate code cannot be
 * mapped in one handler and missed in another. Returns null for other errors.
 */
export function mapCheckoutGateError(err: unknown, req: Request, res: Response): Response | null {
  if (err instanceof CheckoutPreconditionError) {
    if (err.code === "STAGING_CONFLICT") {
      return res.status(409).json({
        code: err.code,
        error: "You are not the top priority claim holder",
        queue: err.extra?.queue,
      });
    }
    if (err.code === "BUNDLE_INCOMPLETE") {
      return res.status(422).json({ code: err.code, ...err.extra });
    }
    return res.status(err.httpStatus).json({
      code: err.code,
      error: typeof err.extra?.error === "string" ? err.extra.error : err.message,
      ...err.extra,
    });
  }
  if (err instanceof EquipmentWaitlistError) {
    const status = err.code === "WAITLIST_RESERVATION_HELD_BY_OTHER" ? 409 : 422;
    return apiErrorI18n(req, res, `equipmentWaitlist.${err.code}`, undefined, status);
  }
  return null;
}
