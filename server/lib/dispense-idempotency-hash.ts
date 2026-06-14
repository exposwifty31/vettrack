import { createHash } from "crypto";

/**
 * Stable hash of the request body for idempotent replay detection (dispense and similar).
 * Shared by `container-dispense-idempotency` middleware and the dispense route transaction.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function hashDispenseRequestBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}
