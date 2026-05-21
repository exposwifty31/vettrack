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
import {
  handleCheckViolation,
  isCheckViolation,
  isInventoryConstraintError,
} from "../lib/db-constraint-errors.js";

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

function extractPgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof (current as { code: unknown }).code === "string") {
      const code = (current as { code: string }).code;
      if (/^\d{5}$/.test(code) || /^[0-9A-Z]{5}$/.test(code)) return code;
    }
    if (!("cause" in current)) break;
    current = (current as { cause: unknown }).cause;
  }
  return undefined;
}

function respondRestockRouteError(
  route: string,
  requestId: string,
  err: unknown,
  res: { status: (n: number) => { json: (b: unknown) => void } },
): void {
  if (isInventoryConstraintError(err)) {
    res.status(err.status).json({
      code: err.code,
      message: err.message,
      constraint: err.constraint,
      requestId,
    });
    return;
  }
  if (isCheckViolation(err) && handleCheckViolation(err, res as Parameters<typeof handleCheckViolation>[1])) {
    return;
  }
  logRestockError(route, requestId, err);
  const mapped = mapErrorToHttp(err, requestId);
  res.status(mapped.status).json(mapped.body);
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
  if (isInventoryConstraintError(err)) {
    return {
      status: err.status,
      body: {
        code: err.code,
        message: err.message,
        constraint: err.constraint,
        requestId,
      },
    };
  }
  // Phase 5 PR 5.4 — surface the underlying error class as a diagnostic
  // hint for the 500 path so support can identify the failure type
  // (e.g. `PostgresError`, `TimeoutError`) without needing server-log
  // access. The user-facing `message` stays generic; `errorType` is an
  // additive field consumed by operators / support only.
  const errorType =
    err instanceof Error && typeof err.name === "string" && err.name.length > 0
      ? err.name
      : "UnknownError";
  const pgErrorCode = extractPgErrorCode(err);
  return {
    status: 500,
    body: {
      ...apiError({
        code: "INTERNAL_ERROR",
        reason: "RESTOCK_ROUTE_FAILED",
        message: "Restock operation failed",
        requestId,
      }),
      errorType,
      ...(pgErrorCode ? { pgErrorCode } : {}),
    },
  };
}

/**
 * Phase 5 PR 5.4 — structured error log for restock route failures.
 *
 * The pre-existing `console.error(err)` calls log the bare error object,
 * which often serialises to `{}` in production log aggregators. This
 * helper emits a single line with a stable shape (`route`, `requestId`,
 * `errorType`, `message`, `stackFirstLine`) so operators can correlate
 * client-visible `requestId` toasts with server-side context.
 */
function logRestockError(route: string, requestId: string, err: unknown): void {
  const errorType =
    err instanceof Error && typeof err.name === "string" && err.name.length > 0
      ? err.name
      : "UnknownError";
  const message =
    err instanceof Error && typeof err.message === "string" ? err.message : String(err);
  const stackFirstLine =
    err instanceof Error && typeof err.stack === "string"
      ? err.stack.split("\n")[1]?.trim() ?? null
      : null;
  const pgErrorCode = extractPgErrorCode(err);
  console.error("[restock-route]", {
    route,
    requestId,
    errorType,
    ...(pgErrorCode ? { pgErrorCode } : {}),
    message,
    stackFirstLine,
  });
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
      respondRestockRouteError(req.path, requestId, err, res);
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
      respondRestockRouteError(req.path, requestId, err, res);
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
      respondRestockRouteError(req.path, requestId, err, res);
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
      respondRestockRouteError(req.path, requestId, err, res);
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
      respondRestockRouteError(req.path, requestId, err, res);
    }
  },
);

export default router;
