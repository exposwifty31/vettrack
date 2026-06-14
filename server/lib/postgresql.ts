/**
 * PostgreSQL configuration for VetTrack.
 * Connection string: set `DATABASE_URL`, or optionally `POSTGRES_URL` (used if set).
 */
export function isPostgresqlConfigured(): boolean {
  return Boolean(
    process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim(),
  );
}

export function getPostgresqlConnectionString(): string {
  const pg = process.env.POSTGRES_URL?.trim();
  const db = process.env.DATABASE_URL?.trim();

  if (pg && db && pg !== db) {
    throw new Error(
      "Both POSTGRES_URL and DATABASE_URL are set with different values. This is unsafe.",
    );
  }

  const url = pg || db;
  if (!url) {
    throw new Error(
      "PostgreSQL connection string is not set: set DATABASE_URL or POSTGRES_URL",
    );
  }
  return url;
}
