/**
 * Helpers for interpreting node-postgres / Drizzle mutation results and errors.
 */

/** True when an UPDATE/DELETE matched zero rows (version guard miss, etc.). */
export function pgUpdateMatchedZeroRows(result: unknown): boolean {
  const rowCount = (result as { rowCount?: number } | undefined)?.rowCount;
  return rowCount === 0;
}

/** Walks Drizzle-wrapped causes for PostgreSQL unique_violation (23505). */
export function isPostgresUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type ErrorLike = { cause?: unknown };
type ConstraintRecord = { constraint?: string; constraint_name?: string };

function isObjectLike(val: unknown): val is ErrorLike {
  return val !== null && typeof val === "object";
}

function hasConstraint(val: ErrorLike): val is ErrorLike & ConstraintRecord {
  return "constraint" in val || "constraint_name" in val;
}

/**
 * Walks Drizzle-wrapped causes for the violated constraint name.
 *
 * node-postgres stamps the offending constraint onto `.constraint`, but
 * Drizzle wraps the driver error, so the field lives on a `.cause` node —
 * the same chain `isPostgresUniqueViolation` walks. Returns the first
 * `.constraint`/`.constraint_name` found, or `null` when none is present.
 */
export function getPostgresConstraintName(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && isObjectLike(current); depth += 1) {
    if (hasConstraint(current)) {
      const name = current.constraint ?? current.constraint_name;
      if (typeof name === "string" && name.length > 0) return name;
    }
    current = current.cause;
  }
  return null;
}
