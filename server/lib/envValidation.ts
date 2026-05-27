import { isPostgresqlConfigured } from "./postgresql.js";

const INSECURE_FALLBACKS: Record<string, string[]> = {
  SESSION_SECRET: ["vettrack-dev-secret", "dev-secret", "secret", "changeme", "password"],
};

const REQUIRED_IN_PRODUCTION: string[] = [
  "REDIS_URL",
  "SESSION_SECRET",
  "CLERK_SECRET_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "ALLOWED_ORIGIN",
  // Credential encryption — required to decrypt existing vt_server_config rows.
  // Missing in production means integration credentials silently return null
  // (decryptConfigValue throws → getCredentials swallows the error), which
  // looks healthy but breaks every integration sync/validation path.
  // See: server/lib/config-crypto.ts, server/integrations/credential-manager.ts
  "DB_CONFIG_ENCRYPTION_KEY",
];

const RECOMMENDED_IN_PRODUCTION: string[] = [
  // Clerk webhook handler returns 501 if unset (server/routes/webhooks.ts L65),
  // so user-lifecycle sync is degraded but the rest of the app keeps running.
  "CLERK_WEBHOOK_SECRET",
];

function validateClerkKeyPair(): void {
  const publishable = (process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim();
  const secret = (process.env.CLERK_SECRET_KEY ?? "").trim();

  if (!publishable || !secret) return;

  const publishableIsTest = publishable.startsWith("pk_test_");
  const publishableIsLive = publishable.startsWith("pk_live_");
  const secretIsTest = secret.startsWith("sk_test_");
  const secretIsLive = secret.startsWith("sk_live_");

  const isMismatch =
    (publishableIsTest && secretIsLive) ||
    (publishableIsLive && secretIsTest);

  if (isMismatch) {
    console.error("\n❌ FATAL: Clerk key mismatch detected:\n");
    console.error(`  - VITE_CLERK_PUBLISHABLE_KEY: ${publishable.slice(0, 8)}...`);
    console.error(`  - CLERK_SECRET_KEY: ${secret.slice(0, 8)}...`);
    console.error("  - Do not mix test and live Clerk keys.");
    console.error("    Use pk_test + sk_test OR pk_live + sk_live.\n");
    process.exit(1);
  }
}

export function validateEnv(): void {
  validateClerkKeyPair();

  if (process.env.NODE_ENV !== "production") return;

  const errors: string[] = [];

  if (!isPostgresqlConfigured()) {
    errors.push(
      "  - DATABASE_URL or POSTGRES_URL is required in production but is missing or empty",
    );
  }

  for (const varName of REQUIRED_IN_PRODUCTION) {
    const value = process.env[varName];
    if (!value || value.trim() === "") {
      errors.push(`  - ${varName} is required in production but is missing or empty`);
    }
  }

  for (const [varName, insecureValues] of Object.entries(INSECURE_FALLBACKS)) {
    const value = process.env[varName];
    if (value && insecureValues.includes(value)) {
      errors.push(
        `  - ${varName} is set to a known insecure fallback value ("${value}"). Use a strong, random secret in production.`
      );
    }
  }

  for (const varName of RECOMMENDED_IN_PRODUCTION) {
    const value = process.env[varName];
    if (!value || value.trim() === "") {
      console.warn(`⚠️  ${varName} is recommended in production but is missing or empty`);
    }
  }

  if (
    process.env.PILOT_MODE === "true" &&
    process.env.ALLOW_EQUIPMENT_PILOT_MODE !== "true"
  ) {
    errors.push(
      '  - PILOT_MODE=true is not allowed on mainline production. Unset PILOT_MODE (or set to "false") and redeploy. ' +
        "Dedicated equipment-pilot hosts may set ALLOW_EQUIPMENT_PILOT_MODE=true alongside PILOT_MODE=true.",
    );
  }

  if (errors.length > 0) {
    console.error("\n❌ FATAL: Production environment validation failed:\n");
    for (const err of errors) {
      console.error(err);
    }
    console.error(
      "\nFix the above issues before starting the application in production.\n"
    );
    process.exit(1);
  }

  if (!process.env.CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY.trim() === "") {
    console.error("\n❌ FATAL: Production auth is misconfigured:");
    console.error("  - CLERK_SECRET_KEY must be set in production.");
    console.error("    Dev auth fallback is disabled outside NODE_ENV=development.\n");
    process.exit(1);
  }

  console.log("✅ Production environment validation passed");
}
