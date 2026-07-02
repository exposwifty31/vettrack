import { randomUUID } from "crypto";

/**
 * Derives a safe file extension from a user-supplied original filename.
 * Strips path traversal / non-alphanumeric characters and caps length.
 * Falls back to `jpg` when the name carries no usable extension.
 */
export function sanitizeUploadExtension(originalName: string): string {
  const raw = originalName.split(".").pop() ?? "";
  const cleaned = raw.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10);
  return cleaned || "jpg";
}

/** Builds a collision-resistant, tenant-safe object key for a user's avatar. */
export function buildAvatarKey(userId: string, originalName: string): string {
  return `avatars/${userId}-${randomUUID()}.${sanitizeUploadExtension(originalName)}`;
}
