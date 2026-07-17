/**
 * R-M1.1c — admin-only RFID HMAC secret provisioning/rotation + ingest toggle.
 *
 * Replaces `scripts/rfid/provision-secret.ts` + the manual hand-flip of
 * `rfid.ingest_enabled.<clinicId>`. Every handler is `requireAdmin` and derives clinicId
 * from the AUTHENTICATED context ONLY (`req.clinicId`) — never from request input. The
 * rotation secret is returned exactly once (on rotate) and is never logged or cached
 * (`Cache-Control: no-store`). RFID is advisory-only (ADR-006): no custody writes here.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { resolveRequestId } from "../lib/route-utils.js";
import { setRfidIngestEnabled } from "../lib/rfid/config.js";
import {
  ackRotationReader,
  rollbackRfidSecret,
  rotateRfidSecret,
  RfidRotationError,
} from "../lib/rfid/provisioning.js";

const router = Router();

const RotateSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(200) });
const RollbackSchema = z.object({ rotationId: z.string().trim().min(1).max(64) });
const AckSchema = z.object({
  rotationId: z.string().trim().min(1).max(64),
  readerId: z.string().trim().min(1).max(64),
});
const IngestToggleSchema = z.object({ enabled: z.boolean() });

/** clinicId is derived from the authenticated context ONLY — never from request input. */
function requireClinicId(req: Request, res: Response, requestId: string): string | null {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) {
    res.status(400).json({ code: "MISSING_CLINIC_ID", error: "MISSING_CLINIC_ID", message: "clinicId is required", requestId });
    return null;
  }
  return clinicId;
}

function handleRotationError(err: unknown, res: Response, requestId: string, fallback: string): void {
  if (err instanceof RfidRotationError) {
    res.status(err.status).json({ code: err.code, error: err.code, message: err.message, requestId });
    return;
  }
  console.error(`[admin-rfid-provisioning] ${fallback}`, err);
  res.status(500).json({ code: "INTERNAL_ERROR", error: "INTERNAL_ERROR", message: fallback, requestId });
}

/**
 * POST /api/admin/rfid-provisioning/rotate
 * Provision (first time) or rotate the per-clinic HMAC secret. The secret is returned ONCE.
 * A same-key retry replays the original envelope WITHOUT the secret.
 */
router.post("/rfid-provisioning/rotate", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const parsed = RotateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", error: "INVALID_INPUT", message: "idempotencyKey is required", requestId });
      return;
    }
    const rotation = await rotateRfidSecret(clinicId, parsed.data.idempotencyKey);
    // The response carries the plaintext secret (once) — never cache it.
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ clinicId, rotation, requestId });
  } catch (err) {
    handleRotationError(err, res, requestId, "Failed to rotate RFID secret");
  }
});

/** POST /api/admin/rfid-provisioning/rollback — restore previous as current (grace only). */
router.post("/rfid-provisioning/rollback", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const parsed = RollbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", error: "INVALID_INPUT", message: "rotationId is required", requestId });
      return;
    }
    const rotation = await rollbackRfidSecret(clinicId, parsed.data.rotationId);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ clinicId, rotation, requestId });
  } catch (err) {
    handleRotationError(err, res, requestId, "Failed to roll back RFID secret");
  }
});

/** POST /api/admin/rfid-provisioning/ack — record a snapshot reader adopting the new secret. */
router.post("/rfid-provisioning/ack", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const parsed = AckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", error: "INVALID_INPUT", message: "rotationId + readerId are required", requestId });
      return;
    }
    const result = await ackRotationReader(clinicId, parsed.data.rotationId, parsed.data.readerId);
    res.status(200).json({ clinicId, ...result, requestId });
  } catch (err) {
    handleRotationError(err, res, requestId, "Failed to acknowledge RFID rotation");
  }
});

/** PUT /api/admin/rfid-provisioning/ingest — toggle rfid.ingest_enabled.<clinicId>. */
router.put("/rfid-provisioning/ingest", requireAuth, requireAdmin, async (req, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = requireClinicId(req, res, requestId);
    if (!clinicId) return;
    const parsed = IngestToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "INVALID_INPUT", error: "INVALID_INPUT", message: "enabled (boolean) is required", requestId });
      return;
    }
    await setRfidIngestEnabled(clinicId, parsed.data.enabled);
    res.status(200).json({ clinicId, enabled: parsed.data.enabled, requestId });
  } catch (err) {
    console.error("[admin-rfid-provisioning] ingest toggle failed", err);
    res.status(500).json({ code: "INTERNAL_ERROR", error: "INTERNAL_ERROR", message: "Failed to toggle RFID ingest", requestId });
  }
});

export default router;
