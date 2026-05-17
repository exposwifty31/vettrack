import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { resolveAuditActorRole } from "../lib/audit.js";
import { applyGlobalErModeToggle } from "../lib/er-mode-toggle.js";
import { canManageErModeForUser } from "../lib/er-mode-permissions.js";
import { getClinicErModeState } from "../lib/er-mode.js";
import { apiError as i18nApiError } from "../lib/apiError.js";

const router = Router();
router.use(requireAuth);

const toggleSchema = z.object({
  activate: z.boolean(),
});

function resolveRequestId(res: Response, incoming: unknown): string {
  const incomingStr = typeof incoming === "string" ? incoming.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incomingStr || fromRes || randomUUID();
  res.setHeader("x-request-id", requestId);
  return requestId;
}

function apiError(params: { code: string; reason: string; message: string; requestId: string }) {
  return { error: params.code, reason: params.reason, message: params.message, requestId: params.requestId };
}

router.post("/toggle-global-mode", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  const user = req.authUser;
  if (!user) {
    // Phase 6 PR 6.10 light adoption (1 of 1 in er-admin.ts).
    i18nApiError(req, res, "errors.er.notAuthenticated", undefined, 401);
    return;
  }

  if (!canManageErModeForUser(user)) {
    res.status(403).json(
      apiError({
        code: "FORBIDDEN",
        reason: "INSUFFICIENT_PRIVILEGE",
        message: "Insufficient privileges to manage ER mode.",
        requestId,
      }),
    );
    return;
  }

  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(apiError({ code: "VALIDATION_ERROR", reason: "INVALID_BODY", message: parsed.error.message, requestId }));
    return;
  }

  try {
    const { erModeState } = await applyGlobalErModeToggle({
      clinicId: user.clinicId,
      activate: parsed.data.activate,
      actorId: user.id,
      actorEmail: user.email ?? "",
      actorRole: resolveAuditActorRole(req),
    });
    res.status(200).json({ erModeState, requestId });
  } catch (err) {
    console.error("[er-admin] POST /toggle-global-mode failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ER_MODE_UPDATE_FAILED", message: "Failed to update ER mode", requestId }),
    );
  }
});

/** Probe current mode + auth for operators / automated checks (no mutation). */
router.get("/toggle-global-mode", async (req: Request, res: Response) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);

  const user = req.authUser;
  if (!user) {
    res.status(401).json(apiError({ code: "UNAUTHORIZED", reason: "NOT_AUTHENTICATED", message: "Authentication required", requestId }));
    return;
  }
  if (!canManageErModeForUser(user)) {
    res.status(403).json(
      apiError({
        code: "FORBIDDEN",
        reason: "INSUFFICIENT_PRIVILEGE",
        message: "Insufficient privileges to manage ER mode.",
        requestId,
      }),
    );
    return;
  }
  try {
    const erModeState = await getClinicErModeState(user.clinicId);
    res.status(200).json({ erModeState, requestId });
  } catch (err) {
    console.error("[er-admin] GET /toggle-global-mode failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "ER_MODE_FETCH_FAILED", message: "Failed to read ER mode", requestId }),
    );
  }
});

export default router;
