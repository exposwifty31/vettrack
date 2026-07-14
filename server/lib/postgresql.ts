/**
 * PostgreSQL configuration for VetTrack.
 *
 * Runtime pool (`getPostgresqlConnectionString`): prefers `PGBOUNCER_URL` (a
 * pooled endpoint, e.g. Railway PgBouncer) when set, else `POSTGRES_URL`, else
 * `DATABASE_URL`.
 *
 * Migrations (`getDirectPostgresqlConnectionString`): must NEVER use PgBouncer —
 * `migrate.ts` holds a session-level `pg_advisory_lock`, which breaks under
 * PgBouncer transaction pooling (acquire/release can land on different backends).
 * So migrations always take a direct `POSTGRES_URL || DATABASE_URL` connection.
 */

function assertPgDbConsistent(pg: string | undefined, db: string | undefined): void {
  if (pg && db && pg !== db) {
    throw new Error(
      "Both POSTGRES_URL and DATABASE_URL are set with different values. This is unsafe.",
    );
  }
}

export function isPostgresqlConfigured(): boolean {
  return Boolean(
    process.env.PGBOUNCER_URL?.trim() ||
      process.env.POSTGRES_URL?.trim() ||
      process.env.DATABASE_URL?.trim(),
  );
}

/** Runtime connection string for the app pool — pooled (PgBouncer) when available. */
export function getPostgresqlConnectionString(): string {
  const pgbouncer = process.env.PGBOUNCER_URL?.trim();
  const pg = process.env.POSTGRES_URL?.trim();
  const db = process.env.DATABASE_URL?.trim();

  // PGBOUNCER_URL is an intentional, higher-priority override; the consistency
  // guard is only about a POSTGRES_URL/DATABASE_URL mismatch.
  assertPgDbConsistent(pg, db);

  const url = pgbouncer || pg || db;
  if (!url) {
    throw new Error(
      "PostgreSQL connection string is not set: set DATABASE_URL or POSTGRES_URL",
    );
  }
  return url;
}

/**
 * Direct (non-PgBouncer) connection string for migrations. Ignores PGBOUNCER_URL
 * so the migration advisory lock stays on one backend for its whole session.
 */
export function getDirectPostgresqlConnectionString(): string {
  const pg = process.env.POSTGRES_URL?.trim();
  const db = process.env.DATABASE_URL?.trim();

  assertPgDbConsistent(pg, db);

  const url = pg || db;
  if (!url) {
    throw new Error(
      "Direct PostgreSQL connection string is not set: set DATABASE_URL or POSTGRES_URL",
    );
  }
  return url;
}
