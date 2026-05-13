import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  cancelSession,
  finishSession,
  getContainerInventoryView,
  resolveItemByNFCTag,
  RestockServiceError,
  scanItem,
  startRestockSession,
} from "../services/restock.service.js";

const router = Router();

const startSchema = z.object({
  containerId: z.string().uuid(),
});

const scanSchema = z
  .object({
    sessionId: z.string().uuid(),
    itemId: z.string().uuid().optional(),
    nfcTagId: z.string().trim().min(1).max(200).optional(),
    /** Absolute observed quantity (what the technician counted). */
    observedQuantity: z.number().int().min(0),
  })
  .strict();

const finishSchema = z.object({
  sessionId: z.string().uuid(),
});

const cancelSchema = z.object({
  sessionId: z.string().uuid(),
});

const containerItemsSchema = z.object({
  containerId: z.string().uuid(),
});

function resolveRequestId(
  res: { getHeader: (n: string) => unknown; setHeader?: (n: string, v: string) => void },
  incoming: unknown,
): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  if (typeof res.setHeader === "function") res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

function mapErrorToHttp(err: unknown, requestId: string) {
  if (err instanceof RestockServiceError) {
    return {
      status: err.status,
      body: apiError({
        code: err.code,
        reason: err.code,
        message: err.message,
        requestId,
      }),
    };
  }
  return {
    status: 500,
    body: apiError({
      code: "INTERNAL_ERROR",
      reason: "RESTOCK_ROUTE_FAILED",
      message: "Restock operation failed",
      requestId,
    }),
  };
}

router.post(
  "/start",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(startSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const body = req.body as z.infer<typeof startSchema>;
      const session = await startRestockSession({
        clinicId: req.clinicId!,
        containerId: body.containerId,
        userId: req.authUser!.id,
      });
      res.status(201).json(session);
    } catch (err) {
      console.error(err);
      const mapped = mapErrorToHttp(err, requestId);
      res.status(mapped.status).json(mapped.body);
    }
  },
);

router.post(
  "/scan",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(scanSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const body = req.body as z.infer<typeof scanSchema>;
      let itemId = body.itemId ?? null;
      if (!itemId && body.nfcTagId) {
        const item = await resolveItemByNFCTag({
          clinicId: req.clinicId!,
          nfcTagId: body.nfcTagId,
        });
        itemId = item.id;
      }
      if (!itemId) {
        return res.status(400).json(
          apiError({
            code: "VALIDATION_FAILED",
            reason: "ITEM_ID_REQUIRED",
            message: "Either itemId or nfcTagId must be provided",
            requestId,
          }),
        );
      }

      const result = await scanItem({
        clinicId: req.clinicId!,
        sessionId: body.sessionId,
        itemId,
        observedQuantity: body.observedQuantity,
        userId: req.authUser!.id,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      const mapped = mapErrorToHttp(err, requestId);
      res.status(mapped.status).json(mapped.body);
    }
  },
);

router.post(
  "/finish",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(finishSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const body = req.body as z.infer<typeof finishSchema>;
      const result = await finishSession({
        clinicId: req.clinicId!,
        sessionId: body.sessionId,
        userId: req.authUser!.id,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      const mapped = mapErrorToHttp(err, requestId);
      res.status(mapped.status).json(mapped.body);
    }
  },
);

router.post(
  "/cancel",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(cancelSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const body = req.body as z.infer<typeof cancelSchema>;
      const result = await cancelSession({
        clinicId: req.clinicId!,
        sessionId: body.sessionId,
        userId: req.authUser!.id,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      const mapped = mapErrorToHttp(err, requestId);
      res.status(mapped.status).json(mapped.body);
    }
  },
);

router.post(
  "/container-items",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(containerItemsSchema),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const body = req.body as z.infer<typeof containerItemsSchema>;
      const result = await getContainerInventoryView({
        clinicId: req.clinicId!,
        containerId: body.containerId,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      const mapped = mapErrorToHttp(err, requestId);
      res.status(mapped.status).json(mapped.body);
    }
  },
);

export default router;
