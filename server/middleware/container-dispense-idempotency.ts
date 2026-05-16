import type { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Locals {
      /** Set by `dispenseIdempotencyMiddleware` when a new idempotency key is accepted. */
      dispenseIdempotencyKey?: string;
      /** When true, `POST /dispense` persisted `vt_idempotency_keys` inside its DB transaction — skip duplicate insert on `finish`. */
      dispenseIdempotencyPersistedInTransaction?: boolean;
    }
  }
}
import { and, eq } from "drizzle-orm";
import { db, idempotencyKeys } from "../db.js";
import { hashDispenseRequestBody } from "../lib/dispense-idempotency-hash.js";

export const DISPENSE_IDEMPOTENCY_ENDPOINT = "POST /api/containers/:id/dispense";

/**
 * Requires `Idempotency-Key`; reads cached `(status, body)` from `vt_idempotency_keys`
 * when the same clinic + key + request hash replays; otherwise runs the handler and
 * persists the response after `finish` (unless the handler already recorded the response in-`tx`).
 */
export const dispenseIdempotencyMiddleware: RequestHandler = async (req, res, next) => {
  const raw = req.headers["idempotency-key"];
  const headerKey = typeof raw === "string" ? raw.trim() : "";
  if (!headerKey) {
    res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "IDEMPOTENCY_KEY_REQUIRED",
      message: "Idempotency-Key header is required",
    });
    return;
  }

  const clinicId = req.clinicId?.trim();
  if (!clinicId) {
    res.status(400).json({
      code: "VALIDATION_FAILED",
      error: "VALIDATION_FAILED",
      reason: "CLINIC_REQUIRED",
      message: "Clinic context required for idempotent dispense",
    });
    return;
  }

  const requestHash = hashDispenseRequestBody(req.body);

  try {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.clinicId, clinicId), eq(idempotencyKeys.key, headerKey)))
      .limit(1);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        res.status(409).json({
          code: "IDEMPOTENCY_CONFLICT",
          error: "IDEMPOTENCY_CONFLICT",
          reason: "IDEMPOTENCY_KEY_BODY_MISMATCH",
          message: "Idempotency-Key was reused with a different request body",
        });
        return;
      }
      // Phase 5 PR 5.7 post-merge fix (Codex P2): re-emit the
      // `X-COP-Validation-Status: degraded` header on idempotent
      // replay when the first write recorded a degraded validation.
      // The flag is persisted as `copValidationDegraded: true` inside
      // `responseBody` by the container-dispense route. Without this
      // re-emit, a client retrying the same idempotency key after a
      // fail-open success would never see that validation was
      // degraded for the persisted mutation (CI-13 still holds — the
      // header is backend operational only; no Phase 5 client
      // consumes it).
      if (
        existing.responseBody &&
        typeof existing.responseBody === "object" &&
        (existing.responseBody as Record<string, unknown>).copValidationDegraded === true
      ) {
        res.setHeader("X-COP-Validation-Status", "degraded");
      }
      res.status(existing.statusCode).json(existing.responseBody);
      return;
    }
  } catch (err) {
    console.error("[dispense-idempotency] lookup failed", err);
    res.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      error: "SERVICE_UNAVAILABLE",
      reason: "IDEMPOTENCY_STORE_UNAVAILABLE",
      message: "Could not verify idempotency; try again",
    });
    return;
  }

  res.locals.dispenseIdempotencyKey = headerKey;

  const origJson = res.json.bind(res);
  let captured: unknown;
  res.json = (body: unknown) => {
    captured = body;
    return origJson(body);
  };

  res.once("finish", () => {
    if (res.locals.dispenseIdempotencyPersistedInTransaction) return;
    if (captured === undefined) return;
    void db
      .insert(idempotencyKeys)
      .values({
        clinicId,
        key: headerKey,
        endpoint: DISPENSE_IDEMPOTENCY_ENDPOINT,
        requestHash,
        statusCode: res.statusCode,
        responseBody: captured as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [idempotencyKeys.clinicId, idempotencyKeys.key],
        set: {
          endpoint: DISPENSE_IDEMPOTENCY_ENDPOINT,
          requestHash,
          statusCode: res.statusCode,
          responseBody: captured as Record<string, unknown>,
        },
      })
      .catch((err: unknown) => {
        console.error("[dispense-idempotency] persist failed", err);
      });
  });

  next();
};
