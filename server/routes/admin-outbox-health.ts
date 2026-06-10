import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { evaluateOutboxHealthForClinic } from "../lib/outbox-health.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";

const router = Router();


/**
 * GET /api/admin/outbox-health
 * Clinic-scoped backlog and publisher lag for observability.
 */
router.get("/outbox-health", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId?.trim();
    if (!clinicId) {
      res.status(400).json({
        code: "MISSING_CLINIC_ID",
        error: "MISSING_CLINIC_ID",
        reason: "MISSING_CLINIC_ID",
        message: "clinicId is required",
        requestId,
      });
      return;
    }

    const ev = await evaluateOutboxHealthForClinic(clinicId);

    res.status(200).json({
      clinicId: ev.clinicId,
      publish_lag_ms: ev.publish_lag_ms,
      outbox_size: ev.outbox_size,
      events_per_sec: ev.events_per_sec,
      duplicate_drops_count: ev.duplicate_drops_count,
      gap_resync_count: ev.gap_resync_count,
      failed_publish_attempts: ev.failed_publish_attempts,
      dead_letter_count: ev.dead_letter_count,
      dlq_permanent_count: ev.dlq_permanent_count,
      dlq_transient_count: ev.dlq_transient_count,
      dlq_unclassified_count: ev.dlq_unclassified_count,
      next_retry_wave_in_ms: ev.next_retry_wave_in_ms,
      max_retry_horizon_ms: ev.max_retry_horizon_ms,
      requestId,
    });
  } catch (err) {
    console.error("[admin-outbox-health] failed", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Failed to load outbox health",
      requestId,
    });
  }
});

export default router;
