/**
 * R-RTC-1.7 — bounded-enum telemetry for the collaboration channel.
 *
 * The complete closed set of collab metric names. `recordCollabMetric` rejects at
 * runtime any name that is not an EXACT member of this allowlist (membership is the
 * sole check — whether the string was a literal or dynamically built is irrelevant).
 * No PII, no raw coordinates, no free-form labels ever pass through here.
 */
import { incrementMetric } from "../metrics.js";

export const COLLAB_METRICS = [
  "collab_ws_connected",
  "collab_ws_disconnected",
  "collab_typing",
  "collab_presence",
  "collab_cursor_dropped",
  "collab_board_rate_limited",
  "collab_record_presence",
] as const;

export type CollabMetric = (typeof COLLAB_METRICS)[number];

const ALLOWLIST: ReadonlySet<string> = new Set(COLLAB_METRICS);

/** True iff `name` is an exact member of the closed collab-metric allowlist. */
export function isCollabMetric(name: string): name is CollabMetric {
  return ALLOWLIST.has(name);
}

/**
 * Record a collab metric. Returns false (and records nothing) for any name outside
 * the closed allowlist — the runtime rejection R-RTC-1.7 requires. On accept it
 * routes through the shared bounded `incrementMetric` union.
 */
export function recordCollabMetric(name: string, value = 1): boolean {
  if (!isCollabMetric(name)) return false;
  incrementMetric(name, value);
  return true;
}
