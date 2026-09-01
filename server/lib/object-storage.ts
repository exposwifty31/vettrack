import { S3Client, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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

export type ObjectDeletionOutcome = "deleted" | "skipped" | "failed";

/**
 * Delete a stored object by key. NEVER THROWS.
 *
 * Exists because dropping the database pointer is not deletion. Account deletion
 * used to set `avatarUrl: null` and stop there, which left the uploaded image in
 * the bucket — unreachable (the bucket is private and every read is presigned
 * from the key) but not erased. "Unreachable" is not the answer Play's Data
 * safety form asks for.
 *
 * Non-fatal on purpose, and the reason matters: the caller is a user exercising
 * their right to delete their account (App Store Guideline 5.1.1(v)). A bucket
 * outage must not be able to refuse that right, so a failure is reported and
 * logged with the key rather than thrown — the audit row is what makes an
 * orphaned object reconcilable instead of invisible.
 *
 * `skipped` covers three distinct non-failures: nothing stored, storage not
 * configured in this environment, and a legacy row holding an absolute URL that
 * this bucket does not own and must not try to delete.
 */
export async function deleteStoredObject(
  keyOrUrl: string | null | undefined,
): Promise<ObjectDeletionOutcome> {
  if (!keyOrUrl) return "skipped";
  if (/^https?:\/\//i.test(keyOrUrl)) return "skipped";
  if (!isObjectStorageConfigured()) return "skipped";

  try {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: keyOrUrl }),
    );
    return "deleted";
  } catch (err) {
    console.error("[object-storage] delete failed — object left orphaned", {
      key: keyOrUrl,
      err: err instanceof Error ? err.message : err,
    });
    return "failed";
  }
}
