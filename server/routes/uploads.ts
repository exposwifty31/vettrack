import { randomUUID } from "crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db, users } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { buildAvatarKey } from "../lib/upload-filename.js";
import { detectImageType, type AllowedImageMime } from "../lib/image-signature.js";
import {
  getS3Client,
  isObjectStorageConfigured,
  presignObjectUrl,
} from "../lib/object-storage.js";

const router = express.Router();



const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    // Coarse early reject. The declared mimetype is client-controlled and not
    // trusted for the accept decision — that is done by magic-byte content
    // detection in each handler (see detectImageType). SVG is refused outright
    // because it is script-capable and executes on top-level navigation.
    if (!file.mimetype.startsWith("image/") || file.mimetype === "image/svg+xml") {
      return cb(new Error("Images only"));
    }
    cb(null, true);
  },
});

/**
 * Runs the multer single-image parse and maps its rejections (bad type, too
 * large) to a 400 apiError. Multer errors otherwise flow to `next(err)` and the
 * app-level handler returns a generic 500 — bypassing each route's try/catch.
 */
function uploadSingleImage(req: Request, res: Response, next: NextFunction) {
  upload.single("image")(req, res, (err: unknown) => {
    if (!err) return next();
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "FILE_TOO_LARGE", message: "Image exceeds the 5MB limit", requestId }));
    }
    if (err instanceof Error && err.message === "Images only") {
      return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_FILE_TYPE", message: "Only image files are allowed", requestId }));
    }
    return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "UPLOAD_FAILED", message: "Upload failed", requestId }));
  });
}

/**
 * Rejects content whose bytes are not a recognized raster image (the client
 * mimetype is untrusted). Sends a 400 and returns null on failure so callers
 * can `if (!type) return;`; returns the detected type otherwise.
 */
function validateImageBuffer(buffer: Buffer, res: Response, requestId: string): AllowedImageMime | null {
  const detected = detectImageType(buffer);
  if (!detected) {
    res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_FILE_TYPE", message: "Only raster image files (PNG, JPEG, WebP, GIF, HEIC) are allowed", requestId }));
    return null;
  }
  return detected;
}

router.post(
  "/fault-image",
  requireAuth,
  requireEffectiveRole("technician"),
  uploadSingleImage,
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      if (!req.file) {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "NO_IMAGE_UPLOADED", message: "No image uploaded", requestId }));
      }

      if (!isObjectStorageConfigured()) {
        return res.status(501).json(
          apiError({
            code: "NOT_IMPLEMENTED",
            reason: "OBJECT_STORAGE_NOT_CONFIGURED",
            message:
              "Image uploads are not available in this environment. Configure S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (Railway object storage) to enable them.",
            requestId,
          }),
        );
      }

      // Reject anything whose bytes are not a recognized raster image, even if
      // the client labeled it image/*. Blocks SVG/HTML smuggling (stored XSS).
      const detectedType = validateImageBuffer(req.file.buffer, res, requestId);
      if (!detectedType) return;

      // Safe filename — no path traversal, no user-controlled strings
      const ext = (req.file.originalname.split(".").pop() ?? "jpg")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase()
        .slice(0, 10);
      const fileName = `faults/${Date.now()}-${randomUUID()}.${ext}`;

      await getS3Client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: fileName,
          Body: req.file.buffer,
          ContentType: detectedType,
        })
      );

      // Railway buckets are private — return a presigned GET URL. The `key` is
      // included so callers that persist the reference long-term should store it
      // and presign on read (as GET /me does) rather than the expiring URL.
      const url = await presignObjectUrl(fileName);

      res.json({ success: true, url, key: fileName });
    } catch (error) {
      console.error("[storage/fault-image]", error);
      res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "UPLOAD_FAILED", message: "Upload failed", requestId }));
    }
  }
);

router.post(
  "/avatar",
  requireAuth,
  uploadSingleImage,
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      if (!req.file) {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "NO_IMAGE_UPLOADED", message: "No image uploaded", requestId }));
      }

      if (!isObjectStorageConfigured()) {
        return res.status(501).json(
          apiError({
            code: "NOT_IMPLEMENTED",
            reason: "OBJECT_STORAGE_NOT_CONFIGURED",
            message:
              "Avatar uploads are not available in this environment. Configure S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (Railway object storage) to enable them.",
            requestId,
          }),
        );
      }

      const detectedType = validateImageBuffer(req.file.buffer, res, requestId);
      if (!detectedType) return;

      const actor = req.authUser!;
      const fileName = buildAvatarKey(actor.id, req.file.originalname);

      await getS3Client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: fileName,
          Body: req.file.buffer,
          ContentType: detectedType,
        }),
      );

      // Railway buckets are private — persist the object KEY and serve reads via
      // short-lived presigned URLs (both here and on GET /me).
      await db
        .update(users)
        .set({ avatarUrl: fileName })
        .where(and(eq(users.id, actor.id), eq(users.clinicId, actor.clinicId)));

      const url = await presignObjectUrl(fileName);

      res.json({ success: true, url });
    } catch (error) {
      console.error("[uploads/avatar]", error);
      res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "UPLOAD_FAILED", message: "Upload failed", requestId }));
    }
  },
);

export default router;
