import { Router, type Request, type Response } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { listNotificationDeliveries } from "../services/admin-notifications.service.js";

const router = Router();

/**
 * GET /api/admin/notifications
 * Clinic-scoped notification-delivery log (push subscriptions + WhatsApp alerts).
 * Targets are masked server-side — no raw endpoints, push keys, phone numbers, or
 * message bodies cross the wire. Read-only.
 */
router.get("/notifications", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) return apiError(req, res, "errors.generic", undefined, 400);
  try {
    const deliveries = await listNotificationDeliveries(clinicId);
    res.status(200).json({ clinicId, deliveries });
  } catch (err) {
    console.error("[admin-notifications] failed", err);
    return apiError(req, res, "errors.generic", undefined, 500);
  }
});

export default router;
