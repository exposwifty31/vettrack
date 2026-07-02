import { randomUUID } from "crypto";
import express from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { db, users } from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { buildAvatarKey } from "../lib/upload-filename.js";
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
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Images only"));
    }
    cb(null, true);
  },
});

router.post(
  "/fault-image",
  requireAuth,
  requireEffectiveRole("technician"),
  upload.single("image"),
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      if (!req.file) {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "NO_IMAGE_UPLOADED", message: "No image uploaded", requestId }));
      }

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
          ContentType: req.file.mimetype,
        })
      );

      // S3_PUBLIC_URL should be set in env, e.g. https://your-bucket.s3.amazonaws.com
      // or https://your-endpoint/your-bucket for S3-compatible providers
      const imageUrl = `${process.env.S3_PUBLIC_URL}/${fileName}`;

      res.json({ success: true, url: imageUrl });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Images only"
      ) {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_FILE_TYPE", message: "Only image files are allowed", requestId }));
      }
      console.error("[storage/fault-image]", error);
      res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "UPLOAD_FAILED", message: "Upload failed", requestId }));
    }
  }
);

router.post(
  "/avatar",
  requireAuth,
  upload.single("image"),
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

      const actor = req.authUser!;
      const fileName = buildAvatarKey(actor.id, req.file.originalname);

      await getS3Client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: fileName,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
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
      if (error instanceof Error && error.message === "Images only") {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_FILE_TYPE", message: "Only image files are allowed", requestId }));
      }
      console.error("[uploads/avatar]", error);
      res.status(500).json(apiError({ code: "INTERNAL_ERROR", reason: "UPLOAD_FAILED", message: "Upload failed", requestId }));
    }
  },
);

export default router;
