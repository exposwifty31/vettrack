import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getPostgresqlConnectionString } from "./lib/postgresql.js";

// Managed Postgres providers (Neon, Supabase, Heroku, Railway public proxy, …)
// require TLS and signal it via `sslmode=require` in the URL. Enable SSL when
// either the URL asks for it or we're in production.
const DB_URL = getPostgresqlConnectionString();
const URL_REQUIRES_SSL = /[?&]sslmode=(require|verify-ca|verify-full)\b/i.test(DB_URL);

export const pool = new Pool({
  connectionString: DB_URL,
  ssl:
    process.env.NODE_ENV === "production" || URL_REQUIRES_SSL
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === "true" }
      : false,
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
