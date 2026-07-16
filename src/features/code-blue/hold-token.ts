/**
 * R-CBF-1.3 — per-gesture idempotency token for the one-tap Code Blue hold.
 *
 * The client generates ONE token per hold gesture and persists it across retries
 * of the same commit (R-CBF-1.1 §Idempotency). The server enforces uniqueness per
 * `(clinicId, token)` and resolves a duplicate by claim state — so a retried
 * commit that reuses the same token replays the committed session rather than
 * starting a second one.
 */
export function generateHoldToken(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the non-crypto fallback below
  }
  return `cbf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
