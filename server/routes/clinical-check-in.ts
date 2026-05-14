import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  requireAdmin,
  requireAuth,
  requireClinicalUser,
  type AuthUser,
} from "../middleware/auth.js";
import { validateUuid } from "../middleware/validate.js";
import { resolveAuditActorRole } from "../lib/audit.js";
import {
  ClinicalCheckInError,
  closeCheckIn,
  forceCloseCheckIn,
  getActiveCheckIn,
  getAllowedOperationalRoles,
  openCheckIn,
  type ActorRole,
  type CheckInActor,
} from "../services/clinical-check-in.js";
import type { ClinicalCheckIn } from "../db.js";

const router = Router();

const checkInBodySchema = z
  .object({
    operationalRole: z.string().min(1).optional(),
  })
  .strict();

const forceCloseBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const IDEMPOTENCY_KEY_MAX_LENGTH = 64;

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

function apiError(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
}) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

function actorFromRequest(authUser: AuthUser): CheckInActor {
  return {
    userId: authUser.id,
    email: authUser.email ?? "",
    clinicId: authUser.clinicId,
    role: authUser.role as ActorRole,
  };
}

function serializeCheckIn(row: ClinicalCheckIn) {
  return {
    id: row.id,
    clinicId: row.clinicId,
    userId: row.userId,
    operationalRole: row.operationalRole,
    clinicalRoleAtCheckIn: row.clinicalRoleAtCheckIn,
    checkedInAt: row.checkedInAt.toISOString(),
    checkedOutAt: row.checkedOutAt ? row.checkedOutAt.toISOString() : null,
    checkOutReason: row.checkOutReason,
  };
}

function resolveIdempotencyKey(
  headerValue: unknown,
  res: Response,
  requestId: string,
): { ok: true; value: string | null } | { ok: false } {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof raw !== "string") return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    res.status(400).json(
      apiError({
        code: "IDEMPOTENCY_KEY_TOO_LONG",
        reason: "IDEMPOTENCY_KEY_TOO_LONG",
        message: "Idempotency-Key exceeds 64 characters",
        requestId,
      }),
    );
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

function handleServiceError(err: unknown, res: Response, requestId: string): void {
  if (err instanceof ClinicalCheckInError) {
    res
      .status(err.status)
      .json(apiError({ code: err.code, reason: err.reason, message: err.message, requestId }));
    return;
  }
  console.error("[clinical-check-in] internal error", err);
  res.status(500).json(
    apiError({
      code: "INTERNAL_ERROR",
      reason: "CLINICAL_CHECK_IN_FAILED",
      message: "Clinical check-in failed",
      requestId,
    }),
  );
}

router.post(
  "/check-in",
  requireAuth,
  requireClinicalUser,
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    const parsed = checkInBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const message = first
        ? `${first.path.join(".") || "body"}: ${first.message}`
        : "Invalid body";
      res.status(400).json(
        apiError({
          code: "INVALID_BODY",
          reason: "INVALID_BODY",
          message,
          requestId,
        }),
      );
      return;
    }

    const keyResult = resolveIdempotencyKey(
      req.headers["idempotency-key"],
      res,
      requestId,
    );
    if (!keyResult.ok) return;

    try {
      const result = await openCheckIn({
        actor: actorFromRequest(req.authUser!),
        operationalRole: parsed.data.operationalRole,
        idempotencyKey: keyResult.value,
      });
      res.status(200).json(serializeCheckIn(result.row));
    } catch (err) {
      handleServiceError(err, res, requestId);
    }
  },
);

router.post("/check-out", requireAuth, async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const row = await closeCheckIn({
      actor: actorFromRequest(req.authUser!),
      reason: "self",
    });
    res.status(200).json(serializeCheckIn(row));
  } catch (err) {
    handleServiceError(err, res, requestId);
  }
});

router.get("/me/active", requireAuth, async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const row = await getActiveCheckIn(req.authUser!.clinicId, req.authUser!.id);
    res.status(200).json({ active: row ? serializeCheckIn(row) : null });
  } catch (err) {
    handleServiceError(err, res, requestId);
  }
});

router.get(
  "/me/operational-roles",
  requireAuth,
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const allowed = await getAllowedOperationalRoles(
        req.authUser!.id,
        req.authUser!.clinicId,
      );
      res.status(200).json({ allowedOperationalRoles: allowed });
    } catch (err) {
      handleServiceError(err, res, requestId);
    }
  },
);

router.post(
  "/check-ins/:id/admin-force-close",
  requireAuth,
  requireAdmin,
  validateUuid("id"),
  async (req: Request, res: Response) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    // Default missing/undefined body to {} — body is fully optional for this
    // recovery endpoint, and clients commonly POST with no JSON payload.
    const parsed = forceCloseBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const message = first
        ? `${first.path.join(".") || "body"}: ${first.message}`
        : "Invalid body";
      res.status(400).json(
        apiError({
          code: "INVALID_BODY",
          reason: "INVALID_BODY",
          message,
          requestId,
        }),
      );
      return;
    }
    try {
      const result = await forceCloseCheckIn({
        admin: {
          id: req.authUser!.id,
          email: req.authUser!.email ?? "",
          role: resolveAuditActorRole(req) ?? req.authUser!.role,
          clinicId: req.authUser!.clinicId,
        },
        targetCheckInId: req.params.id,
        reason: parsed.data.reason ?? null,
        requestId,
      });
      res.status(200).json({
        ...serializeCheckIn(result.row),
        alreadyClosed: result.alreadyClosed,
      });
    } catch (err) {
      handleServiceError(err, res, requestId);
    }
  },
);

export default router;
