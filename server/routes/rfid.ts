/**
 * RFID doorway ingest — vendor controller POST (no Clerk session).
 * Mounted with raw body parser before express.json — see server/index.ts.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { verifyVetTrackWebhookSignature } from "../integrations/webhooks/verify-signature.js";
import { ingestRfidBatch, RfidDirectionalRejection } from "../lib/rfid-ingest.js";
import { isRfidIngestEnabled } from "../lib/rfid/config.js";
import { getRfidVerificationSecrets } from "../lib/rfid/provisioning.js";
import { incrementMetric } from "../lib/metrics.js";
import { rfidEventLimiter } from "../middleware/rate-limiters.js";

const router = Router();

// R-M1.2a — optional directional fields. A payload MAY carry direction, the gateway pair, both,
// or neither; the ingest resolver makes every combination deterministic. Schema-level guard: a
// gateway pair is BOTH-or-NEITHER (a partial pair is INVALID_SCHEMA, never a silent downgrade).
export const RfidBatchSchema = z.object({
  batchId: z.string().min(1).max(64),
  controllerVersion: z.string().max(32).optional(),
  events: z
    .array(
      z
        .object({
          tagEpc: z.string().min(1).max(128),
          gatewayCode: z.string().min(1).max(64),
          readAt: z.string().datetime(),
          direction: z.enum(["entered", "exited"]).optional(),
          fromGateway: z.string().min(1).max(64).optional(),
          toGateway: z.string().min(1).max(64).optional(),
        })
        .refine((e) => (e.fromGateway == null) === (e.toGateway == null), {
          message: "fromGateway and toGateway must be supplied together",
          path: ["fromGateway"],
        }),
    )
    .min(1)
    .max(200),
});

function jsonErr(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ ok: false, code, message });
}

router.post("/events", rfidEventLimiter, async (req: Request, res: Response) => {
  const clinicHeader = req.headers["x-vettrack-clinic"];
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

  // During a secret rotation's grace window this returns [current, previous]; otherwise just
  // [current] (byte-for-byte the pre-rotation path — no extra query). The HMAC mechanism is
  // unchanged; rotation only widens the accepted-secret set (R-M1.1c).
  const secrets = await getRfidVerificationSecrets(clinicId);
  if (secrets.length === 0) {
    return jsonErr(res, 401, "RFID_NOT_CONFIGURED", "RFID credentials not configured for clinic");
  }

  const signatureHeader = req.headers["x-vettrack-signature"];
  let matchedIndex = -1;
  for (let i = 0; i < secrets.length; i++) {
    if (verifyVetTrackWebhookSignature(rawBody, secrets[i], signatureHeader)) {
      matchedIndex = i;
      break;
    }
  }
  if (matchedIndex === -1) {
    incrementMetric("rfid_batch_rejected_signature");
    return jsonErr(res, 401, "INVALID_SIGNATURE", "Signature verification failed");
  }
  if (matchedIndex > 0) {
    // Verified against the retained PREVIOUS secret during the grace window.
    incrementMetric("rfid_batch_verified_grace_previous");
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

  try {
    const ingestResult = await ingestRfidBatch(clinicId, parsed);
    return res.status(202).json({ ok: true, ...ingestResult });
  } catch (err) {
    // R-M1.2a — a directional payload that cannot be resolved deterministically is a HARD
    // 4xx reject (never a silent downgrade). Any other failure is a genuine 500.
    if (err instanceof RfidDirectionalRejection) {
      incrementMetric("rfid_event_directional_rejected");
      return jsonErr(res, 422, err.code, err.message);
    }
    throw err;
  }
});

export default router;
