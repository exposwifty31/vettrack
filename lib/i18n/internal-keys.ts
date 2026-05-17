/**
 * Shared predicate for "internal" (non-rendering) translation key paths.
 *
 * Phase 6 §5 invariant 13: `_meta.*` is a reserved namespace for
 * non-rendering metadata (terminology notes, plan markers, doc strings —
 * JSON does not support comments, so these live in the dictionary).
 * Values under `_meta.*` are included in en.json ↔ he.json parity but
 * are NEVER resolved by user-facing helpers.
 *
 * This predicate is the single canonical check shared by the four
 * enforcement points enumerated in the plan:
 *   (a) src/lib/i18n.ts::buildTranslations (client accessor tree)
 *   (b) scripts/i18n/generate-types.ts (PR 6.14 typed `t` generator)
 *   (c) server/lib/apiError.ts (server i18n response helper)
 *   (d) notification / push / WhatsApp translation helpers
 *
 * Rule: a key path is "internal" if ANY of its dot-segments starts with
 * an underscore. This covers `_meta`, `_meta.appointmentsPageTerminology`,
 * `foo._bar`, and any future `_*` metadata namespace.
 */
export function isInternalKey(keyPath: string): boolean {
  if (!keyPath) return false;
  const segments = keyPath.split(".");
  for (const segment of segments) {
    if (segment.startsWith("_")) return true;
  }
  return false;
}
