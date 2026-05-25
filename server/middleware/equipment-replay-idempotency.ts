import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, idempotencyKeys } from "../db.js";
import {
  buildEquipmentReplayStorageKey,
  hashEquipmentReplayRequest,
} from "../lib/equipment-replay-idempotency.js";

/**
 * Optional offline replay idempotency for equipment mutations.
 * When `Idempotency-Key` is absent, the request proceeds unchanged (online callers).
 */
export function equipmentReplayIdempotency(endpoint: string): RequestHandler {
  return async (req, res, next) => {
    const raw = req.headers["idempotency-key"];
    const headerKey = typeof raw === "string" ? raw.trim() : "";
    if (!headerKey) {
      next();
      return;
    }

    const clinicId = req.clinicId?.trim();
    const userId = req.authUser?.id?.trim();
    if (!clinicId || !userId) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        error: "VALIDATION_FAILED",
        reason: "CLINIC_AND_USER_REQUIRED",
        message: "Clinic and authenticated user required for idempotent equipment replay",
      });
      return;
    }

    const storageKey = buildEquipmentReplayStorageKey(userId, headerKey);
    const requestHash = hashEquipmentReplayRequest(
      req.method,
      req.originalUrl || req.url,
      req.body,
    );

    try {
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.clinicId, clinicId), eq(idempotencyKeys.key, storageKey)))
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
        if (existing.statusCode === 204) {
          res.status(204).send();
          return;
        }
        res.status(existing.statusCode).json(existing.responseBody);
        return;
      }
    } catch (err) {
      console.error("[equipment-replay-idempotency] lookup failed", err);
      res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        error: "SERVICE_UNAVAILABLE",
        reason: "IDEMPOTENCY_STORE_UNAVAILABLE",
        message: "Could not verify idempotency; try again",
      });
      return;
    }

    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    let captured: unknown;
    let persisted = false;

    res.json = (body: unknown) => {
      captured = body;
      return origJson(body);
    };

    res.send = (body?: unknown) => {
      if (body !== undefined) captured = body;
      return origSend(body);
    };

    res.once("finish", () => {
      if (persisted) return;
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const responseBody: Record<string, unknown> =
        res.statusCode === 204
          ? {}
          : (typeof captured === "object" && captured !== null
              ? (captured as Record<string, unknown>)
              : {});

      persisted = true;
      void db
        .insert(idempotencyKeys)
        .values({
          clinicId,
          key: storageKey,
          endpoint,
          requestHash,
          statusCode: res.statusCode,
          responseBody,
        })
        .onConflictDoUpdate({
          target: [idempotencyKeys.clinicId, idempotencyKeys.key],
          set: {
            endpoint,
            requestHash,
            statusCode: res.statusCode,
            responseBody,
          },
        })
        .catch((err: unknown) => {
          console.error("[equipment-replay-idempotency] persist failed", err);
        });
    });

    next();
  };
}
