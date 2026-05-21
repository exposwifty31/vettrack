/**
 * Staging-only safety gate for E2E seed/cleanup scripts.
 * Refuses production Clerk keys, production DB hosts, and missing staging intent.
 */

const PROD_DB_HOST_MARKERS = [
  "tramway.proxy.rlwy.net",
  "mainline.proxy.rlwy.net",
  "vettrack.uk",
  "production.railway.app",
] as const;

/** Specific staging DB hosts only — do not use broad `*.rlwy.net` (matches production proxies). */
const STAGING_DB_HOST_MARKERS = [
  "postgres.railway.internal",
  "metro.proxy.rlwy.net",
] as const;

export type StagingGuardOptions = {
  /** When true, require TEST_BASE_URL or ALLOWED_ORIGIN to reference staging. */
  requireStagingHost?: boolean;
};

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function assertStagingClerkKeys(): void {
  const secret = readEnv("CLERK_SECRET_KEY");
  const publishable = readEnv("VITE_CLERK_PUBLISHABLE_KEY");

  if (!secret.startsWith("sk_test_")) {
    throw new Error(
      "[staging-guard] CLERK_SECRET_KEY must be a staging Clerk secret (sk_test_*). Refusing production/live keys.",
    );
  }
  if (publishable && !publishable.startsWith("pk_test_")) {
    throw new Error(
      "[staging-guard] VITE_CLERK_PUBLISHABLE_KEY must be pk_test_* for staging E2E.",
    );
  }
  if (publishable.startsWith("pk_live_")) {
    throw new Error("[staging-guard] Live Clerk publishable keys are not allowed.");
  }
}

export function assertStagingDatabase(): void {
  const dbUrl = readEnv("DATABASE_URL") || readEnv("POSTGRES_URL");
  if (!dbUrl) {
    throw new Error("[staging-guard] DATABASE_URL (or POSTGRES_URL) is required.");
  }

  const lower = dbUrl.toLowerCase();
  for (const marker of PROD_DB_HOST_MARKERS) {
    if (lower.includes(marker)) {
      throw new Error(
        `[staging-guard] DATABASE_URL appears to reference production (${marker}). Aborting.`,
      );
    }
  }

  const looksStaging =
    STAGING_DB_HOST_MARKERS.some((m) => lower.includes(m)) ||
    readEnv("STAGING_E2E_FORCE") === "yes";

  if (!looksStaging) {
    throw new Error(
      "[staging-guard] DATABASE_URL does not look like staging. Set STAGING_E2E_FORCE=yes only when you are certain this is the staging database.",
    );
  }
}

export function assertStagingIntent(opts: StagingGuardOptions = {}): void {
  if (readEnv("STAGING_E2E_CONFIRM") !== "yes") {
    throw new Error(
      "[staging-guard] Set STAGING_E2E_CONFIRM=yes to run staging-only seed/cleanup against the configured DATABASE_URL.",
    );
  }

  if (opts.requireStagingHost) {
    const base = readEnv("TEST_BASE_URL") || readEnv("ALLOWED_ORIGIN");
    if (!base.includes("vettrack-staging") && !base.includes("staging")) {
      throw new Error(
        "[staging-guard] TEST_BASE_URL or ALLOWED_ORIGIN must reference the staging deployment.",
      );
    }
  }
}

export function assertStagingE2ePassword(): string {
  const password = readEnv("STAGING_E2E_PASSWORD");
  if (!password || password.length < 12) {
    throw new Error(
      "[staging-guard] STAGING_E2E_PASSWORD must be set (min 12 chars) and must not be committed to git.",
    );
  }
  return password;
}

export function runStagingGuard(opts: StagingGuardOptions = {}): void {
  assertStagingClerkKeys();
  assertStagingDatabase();
  assertStagingIntent(opts);
  assertStagingE2ePassword();
}
