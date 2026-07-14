import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getPostgresqlConnectionString, getPgSslConfig } from "./lib/postgresql.js";

const DB_URL = getPostgresqlConnectionString();

export const pool = new Pool({
  connectionString: DB_URL,
  ssl: getPgSslConfig(DB_URL),
  max: Number.parseInt(process.env.DB_POOL_MAX ?? "20", 10) || 20,
  idleTimeoutMillis: Number.parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS ?? "30000", 10) || 30000,
  connectionTimeoutMillis: Number.parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? "10000", 10) || 10000,
});

export const db = drizzle(pool);

export * from "./schema/index.js";

export async function initDb() {
  // Schema initialization is now handled by the migration runner (server/migrate.ts).
  // This function is kept as a thin wrapper for backwards compatibility.
  console.log("✅ Database ready");
}
