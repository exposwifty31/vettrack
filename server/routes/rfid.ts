/**
 * RFID doorway ingest — vendor controller POST (no Clerk session).
 * Mounted with raw body parser before express.json — see server/index.ts.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCredentials } from "../integrations/credential-manager.js";
import { verifyVetTrackWebhookSignature } from "../integrations/webhooks/verify-signature.js";
import { ingestRfidBatch } from "../lib/rfid-ingest.js";
import { isRfidIngestEnabled } from "../lib/rfid/config.js";
import { incrementMetric } from "../lib/metrics.js";
import { rfidEventLimiter } from "../middleware/rate-limiters.js";

const router = Router();

const RfidBatchSchema = z.object({
  batchId: z.string().min(1).max(64),
  controllerVersion: z.string().max(32).optional(),
  events: z
    .array(
      z.object({
        tagEpc: z.string().min(1).max(128),
        gatewayCode: z.string().min(1).max(64),
        readAt: z.string().datetime(),
      }),
    )
    .min(1)
    .max(200),
});

function jsonErr(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, code, message });
}

router.post("/events", rfidEventLimiter, async (req: Request, res: Response) => {
  const clinicHeader = req.headers["x-vetrack-clinic"];
  const clinicId =
    typeof clinicHeader === "string"
      ? clinicHeader.trim()
      : Array.isArray(clinicHeader)
        ? clinicHeader[0]?.trim()
        : "";

  if (!clinicId) {
    return jsonErr(res, 400, "MISSING_CLINIC", "X-VetTrack-Clinic header is required");
  }

  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    return jsonErr(res, 400, "INVALID_BODY", "Expected raw request body");
  }

  const credentials = await getCredentials(clinicId, "rfid");
  if (!credentials?.webhook_secret?.trim()) {
    return jsonErr(res, 401, "RFID_NOT_CONFIGURED", "RFID credentials not configured for clinic");
  }

  const signatureOk = verifyVetTrackWebhookSignature(
    rawBody,
    credentials.webhook_secret,
    req.headers["x-vetrack-signature"],
  );
  if (!signatureOk) {
    incrementMetric("rfid_batch_rejected_signature");
    return jsonErr(res, 401, "INVALID_SIGNATURE", "Signature verification failed");
  }

  const enabled = await isRfidIngestEnabled(clinicId);
  if (!enabled) {
    incrementMetric("rfid_batch_rejected_flag_off");
    return jsonErr(res, 403, "RFID_INGEST_DISABLED", "RFID ingest is disabled for this clinic");
  }

  let parsed: z.infer<typeof RfidBatchSchema>;
  try {
    const json = JSON.parse(rawBody.toString("utf8")) as unknown;
    parsed = RfidBatchSchema.parse(json);
  } catch {
    incrementMetric("rfid_batch_rejected_schema");
    return jsonErr(res, 400, "INVALID_SCHEMA", "Request body failed validation");
  }

  incrementMetric("rfid_batch_received");

  const ingestResult = await ingestRfidBatch(clinicId, parsed);
  return res.status(202).json({ ok: true, ...ingestResult });
});

export default router;
