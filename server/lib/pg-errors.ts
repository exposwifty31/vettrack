// Postgres error classification. Pure and dependency-free so route handlers can
// turn an expected constraint violation into a documented status code instead of
// letting it fall through to a 500.

/** Postgres SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * True when `err` is a unique-constraint violation raised by `constraint`.
 * Naming the constraint keeps the check narrow — a different unique index on the
 * same table must not be swallowed by the same handler branch.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; constraint?: unknown };
  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === constraint;
}

/** Global unique index on vt_equipment.nfc_tag_id (migrations/018_asset_radar_nfc.sql). */
export const EQUIPMENT_NFC_TAG_UNIQUE_CONSTRAINT = "vt_equipment_nfc_tag_id_unique";
