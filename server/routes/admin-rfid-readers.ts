import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limiters.js";
import { resolveRequestId } from "../lib/route-utils.js";
import { logAudit } from "../lib/audit.js";
import {
  createRfidReader,
  deactivateRfidReader,
  listManagedRfidReaders,
  listRfidReaders,
  renameRfidReader,
} from "../services/rfid-readers.service.js";

const router = Router();

const CreateReaderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  gatewayCode: z.string().trim().min(1).max(64),
  roomId: z.string().trim().min(1).max(64).nullish(),
  physicalLocation: z.string().trim().max(200).nullish(),
});

const RenameReaderSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

/** clinicId is derived from the authenticated context ONLY — never from request input. */
function requireClinicId(req: Request, res: Response, requestId: string): string | null {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) {
    res.status(400).json({
      code: "MISSING_CLINIC_ID",
      error: "MISSING_CLINIC_ID",
      reason: "MISSING_CLINIC_ID",
      message: "clinicId is required",
      requestId,
    });
    return null;
  }
  return clinicId;
}

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

/**
 * GET /api/admin/rfid-readers/managed
 * Clinic-scoped MANAGED reader entities (vt_rfid_readers). `health` derives from the
 * reader's OWN heartbeat (lastReaderHeartbeatAt), never equipment asset-read traffic.
 */
router.get("/rfid-readers/managed", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const readers = await listManagedRfidReaders(clinicId);
    res.status(200).json({ clinicId, readers, requestId });
  } catch (err) {
    console.error("[admin-rfid-readers] managed list failed", err);
    res.status(500).json({
      code: "INTERNAL_ERROR",
      error: "INTERNAL_ERROR",
      reason: "INTERNAL_ERROR",
      message: "Failed to load managed RFID readers",
      requestId,
    });
  }
});

/** POST /api/admin/rfid-readers — create a managed reader (unconfigured; no gate_type yet). */
router.post("/rfid-readers", requireAuth, requireAdmin, writeLimiter, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const parsed = CreateReaderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", error: "INVALID_INPUT", message: "Invalid reader payload", requestId });
      return;
    }
    const reader = await createRfidReader(clinicId, parsed.data);
    logAudit({
      clinicId,
      actionType: "rfid_reader_created",
      performedBy: req.authUser?.id ?? "unknown",
      performedByEmail: req.authUser?.email ?? "unknown",
      targetId: reader.id,
      targetType: "rfid_reader",
      metadata: { name: reader.name, gatewayCode: reader.gatewayCode, requestId },
    });
    res.status(201).json({ clinicId, reader, requestId });
  } catch (err) {
    // Duplicate (clinicId, gatewayCode) trips the DB composite unique.
    if (err instanceof Error && /vt_rfid_readers_clinic_gateway_uq/.test(err.message)) {
      res.status(409).json({ code: "DUPLICATE_GATEWAY", error: "DUPLICATE_GATEWAY", message: "A reader already exists for this gateway", requestId });
      return;
    }
    console.error("[admin-rfid-readers] create failed", err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "INTERNAL_ERROR", message: "Failed to create RFID reader", requestId });
  }
});

/** PATCH /api/admin/rfid-readers/:id — rename. Clinic-scoped; cross-clinic id → 404. */
router.patch("/rfid-readers/:id", requireAuth, requireAdmin, writeLimiter, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const parsed = RenameReaderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", error: "INVALID_INPUT", message: "Invalid rename payload", requestId });
      return;
    }
    const reader = await renameRfidReader(clinicId, req.params.id, parsed.data.name);
    if (!reader) {
      res.status(404).json({ code: "READER_NOT_FOUND", error: "READER_NOT_FOUND", message: "RFID reader not found", requestId });
      return;
    }
    logAudit({
      clinicId,
      actionType: "rfid_reader_renamed",
      performedBy: req.authUser?.id ?? "unknown",
      performedByEmail: req.authUser?.email ?? "unknown",
      targetId: reader.id,
      targetType: "rfid_reader",
      metadata: { name: reader.name, requestId },
    });
    res.status(200).json({ clinicId, reader, requestId });
  } catch (err) {
    console.error("[admin-rfid-readers] rename failed", err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "INTERNAL_ERROR", message: "Failed to rename RFID reader", requestId });
  }
});

/** POST /api/admin/rfid-readers/:id/deactivate — soft-deactivate. Clinic-scoped; cross-clinic id → 404. */
router.post("/rfid-readers/:id/deactivate", requireAuth, requireAdmin, writeLimiter, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const reader = await deactivateRfidReader(clinicId, req.params.id);
    if (!reader) {
      res.status(404).json({ code: "READER_NOT_FOUND", error: "READER_NOT_FOUND", message: "RFID reader not found", requestId });
      return;
    }
    logAudit({
      clinicId,
      actionType: "rfid_reader_deactivated",
      performedBy: req.authUser?.id ?? "unknown",
      performedByEmail: req.authUser?.email ?? "unknown",
      targetId: reader.id,
      targetType: "rfid_reader",
      metadata: { gatewayCode: reader.gatewayCode, requestId },
    });
    res.status(200).json({ clinicId, reader, requestId });
  } catch (err) {
    console.error("[admin-rfid-readers] deactivate failed", err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "INTERNAL_ERROR", message: "Failed to deactivate RFID reader", requestId });
  }
});

export default router;
