import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { resolveRequestId } from "../lib/route-utils.js";

/*
 * PERMISSIONS MATRIX — /api/storage
 * ─────────────────────────────────────────────────────
 * POST /upload-url   technician+   Request a pre-signed upload URL
 * ─────────────────────────────────────────────────────
 */

const router = Router();


function apiError(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
  hint?: string;
}) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
    ...(params.hint ? { hint: params.hint } : {}),
  };
}

const uploadUrlSchema = z.object({
  name: z.string().min(1, "name is required").max(500),
  size: z.number().positive("size must be a positive number"),
  contentType: z.string().min(1, "contentType is required").max(100),
});

router.post("/upload-url", requireAuth, requireEffectiveRole("technician"), validateBody(uploadUrlSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  if (!process.env.REPLIT_OBJECT_STORAGE_BUCKET) {
    return res.status(501).json(
      apiError({
        code: "NOT_IMPLEMENTED",
        reason: "OBJECT_STORAGE_NOT_CONFIGURED",
        message:
          "Image uploads are not available in this environment. To enable uploads, configure the REPLIT_OBJECT_STORAGE_BUCKET environment variable and implement the signed URL generation in server/routes/storage.ts.",
        requestId,
        hint: "In development, images can be hosted externally and referenced by URL instead.",
      }),
    );
  }

  res.status(501).json(
    apiError({
      code: "NOT_IMPLEMENTED",
      reason: "SIGNED_UPLOAD_URL_NOT_IMPLEMENTED",
      message: "Object storage is configured but signed URL generation is not yet implemented.",
      requestId,
      hint: "Implement the upload URL generation in server/routes/storage.ts using your storage provider's SDK.",
    }),
  );
});

export default router;
