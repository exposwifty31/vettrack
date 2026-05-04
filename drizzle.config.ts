import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { Config } from "drizzle-kit";
import { getPostgresqlConnectionString } from "./server/lib/postgresql";

const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  loadDotenv({ path: envLocalPath, override: true });
}

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  loadDotenv({ path: envPath, override: false });
}

export default {
  schema: "./server/db.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: getPostgresqlConnectionString(),
  },
} satisfies Config;
