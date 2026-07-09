import { Router, type Request, type Response } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { apiError } from "../lib/apiError.js";
import { listWebhookEventsForClinic } from "../integrations/webhooks/repository.js";

const router = Router();

/**
 * GET /api/admin/webhooks
 * Clinic-scoped inbound PMS webhook event log (read-only observability). The event
 * `payload` is never selected/returned — only the envelope. Inbound-only; outbound
 * delivery config is a future surface.
 */
router.get("/webhooks", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) return apiError(req, res, "errors.generic", undefined, 400);
  try {
    const events = await listWebhookEventsForClinic(clinicId);
    res.status(200).json({ clinicId, events });
  } catch (err) {
    console.error("[admin-webhooks] failed", err);
    return apiError(req, res, "errors.generic", undefined, 500);
  }
});

export default router;
