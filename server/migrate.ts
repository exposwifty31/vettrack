import { Pool } from "pg";
import { getDirectPostgresqlConnectionString } from "./lib/postgresql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const MIGRATION_ADVISORY_LOCK_ID = 123456;

/**
 * Migrations run on a DIRECT (non-PgBouncer) connection. `runMigrations` holds a
 * session-level `pg_advisory_lock`, which breaks under PgBouncer transaction
 * pooling (acquire/release can land on different backends). The runtime app pool
 * (`./db.ts`) may point at PgBouncer via PGBOUNCER_URL — migrations must not.
 * SSL policy mirrors `./db.ts`.
 */
function createDirectMigrationPool(): Pool {
  const url = getDirectPostgresqlConnectionString();
  const urlRequiresSsl = /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(url);
  return new Pool({
    connectionString: url,
    ssl:
      process.env.NODE_ENV === "production" || urlRequiresSsl
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" }
        : false,
    max: 3,
  });
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vt_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    "SELECT filename FROM vt_migrations ORDER BY filename"
  );
  return new Set(result.rows.map((r) => r.filename));
}

export async function runMigrations(): Promise<void> {
  const pool = createDirectMigrationPool();
  try {
    const lockClient = await pool.connect();
    try {
      console.log(`🔒 Acquiring migration advisory lock (${MIGRATION_ADVISORY_LOCK_ID})`);
      await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_ID]);

      await ensureMigrationsTable(pool);
      let applied = await getAppliedMigrations(pool);

      const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
      if (!fs.existsSync(migrationsDir)) {
        console.log("No migrations directory found, skipping.");
        return;
      }

      const extractNum = (f: string) => {
        const m = f.match(/^(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql") && !f.startsWith("meta/"))
        .sort((a, b) => {
          const diff = extractNum(a) - extractNum(b);
          return diff !== 0 ? diff : a.localeCompare(b);
        });

      for (const filename of files) {
        if (applied.has(filename)) {
          continue;
        }

        const filePath = path.join(migrationsDir, filename);
        const sql = fs.readFileSync(filePath, "utf-8");

        console.log(`⏳ Running migration: ${filename}`);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO vt_migrations (filename) VALUES ($1)", [filename]);
          await client.query("COMMIT");
          console.log(`✅ Applied migration: ${filename}`);
          applied = await getAppliedMigrations(pool);
        } catch (error) {
          await client.query("ROLLBACK");
          console.error(`❌ Migration failed: ${filename}`);
          throw error;
        } finally {
          client.release();
        }
      }

      console.log("✅ All migrations up to date");
    } finally {
      try {
        await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_ID]);
      } catch (error) {
        console.error("⚠️ Failed to release migration advisory lock", error);
      }
      lockClient.release();
    }
  } finally {
    await pool.end();
  }
}
