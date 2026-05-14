/**
 * Phase 2.5 PR 7 — kind-namespaced counter helpers.
 *
 * Thin wrappers over incrementMetric to keep the call sites grep-friendly and
 * keep the stale and OPROLE families clearly separated (single-denial
 * invariant §3.5 — only one family increments per resolution).
 */

import { incrementMetric } from "../../metrics.js";

export const staleEnforceMetrics = {
  wouldHaveDenied(): void {
    incrementMetric("authority_stale_would_have_denied");
  },
  denied(): void {
    incrementMetric("authority_stale_denied");
  },
  /**
   * Tombstone counter. Asserted to remain 0 in tests. If it ever increments
   * in production, an isolation invariant has been broken (a stale denial
   * leaked into the Strategy A / legacy fallback path).
   */
  skippedLegacyPath(): void {
    incrementMetric("authority_stale_skipped_legacy_path");
  },
};

export const oproleEnforceMetrics = {
  denied(): void {
    incrementMetric("authority_oprole_denied");
  },
};
