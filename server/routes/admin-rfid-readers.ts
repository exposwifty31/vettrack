import { Router, type Response } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { resolveRequestId } from "../lib/route-utils.js";
import { listRfidReaders } from "../services/rfid-readers.service.js";

const router = Router();

/**
 * GET /api/admin/rfid-readers
 * Derived, clinic-scoped RFID reader registry (rooms.gatewayCode + doorway heartbeat).
 * Read-only observability; no reader entity is mutated here.
 */
router.get("/rfid-readers", requireAuth, requireAdmin, async (req, res: Response) => {
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

    const readers = await listRfidReaders(clinicId);
    res.status(200).json({ clinicId, readers, requestId });
  } catch (err) {
    console.error("[admin-rfid-readers] failed", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Failed to load RFID readers",
      requestId,
    });
  }
});

export default router;
