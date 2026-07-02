import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Object storage (S3-compatible) helpers.
 *
 * Backed by a Railway Bucket in production. Railway buckets are PRIVATE — there
 * is no public object URL, so stored references are object KEYS and reads are
 * served via short-lived presigned GET URLs (see presignObjectUrl).
 */

/** Presigned GET URLs live for one hour; /me is re-fetched on every app load. */
const PRESIGN_TTL_SECONDS = 60 * 60;

/** True when object storage credentials + bucket are present in this environment. */
export function isObjectStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

export function getS3Client(): S3Client {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set. " +
        "Add them to your Railway environment variables.",
    );
  }
  return new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * Returns a short-lived presigned GET URL for a stored object key, or null when
 * storage is not configured. Values that are already absolute URLs (legacy rows
 * that stored a public URL) are returned unchanged.
 */
export async function presignObjectUrl(
  keyOrUrl: string | null | undefined,
): Promise<string | null> {
  if (!keyOrUrl) return null;
  if (/^https?:\/\//i.test(keyOrUrl)) return keyOrUrl;
  if (!isObjectStorageConfigured()) return null;

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: keyOrUrl }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}
