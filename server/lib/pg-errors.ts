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

/**
 * (clinic_id, code) unique constraint on vt_items, auto-named by Postgres from
 * the inline `UNIQUE (clinic_id, code)` table constraint in
 * migrations/041_inventory_items_and_sessions.sql. Not the drizzle-declared
 * `vt_items_clinic_code_unique` index name — this repo hand-authors migrations
 * (drizzle-kit generate/push is non-functional here), so the schema.ts label
 * never renamed the live constraint. Verified live: `vt_items_clinic_id_code_key`.
 */
export const ITEM_CODE_UNIQUE_CONSTRAINT = "vt_items_clinic_id_code_key";

/** Global unique index on vt_items.nfc_tag_id (migrations/041_inventory_items_and_sessions.sql). */
export const ITEM_NFC_TAG_UNIQUE_CONSTRAINT = "vt_items_nfc_tag_id_key";
