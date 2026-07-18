import { createHmac } from "node:crypto";

import { formatSignature } from "./contract";

/**
 * Module 6 — HMAC signer.
 *
 * `HMAC-SHA256(rawBodyBytes, perClinicSecret)` → lowercase hex, `sha256=`
 * prefix. Matches the server's `verifyVetTrackWebhookSignature` exactly (the
 * signer test verifies against the real function). The caller MUST sign the
 * exact buffer it sends: serialize once (Module 5), sign THAT buffer, POST THAT
 * buffer. Any re-serialization between sign and send breaks the signature.
 *
 * The secret is never logged and never returned; only the derived header is.
 */
export function signBody(body: Buffer, secret: string): string {
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  return formatSignature(hex);
}
