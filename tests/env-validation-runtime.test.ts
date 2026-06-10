/**
 * Runtime tests for validateEnv / validateClerkKeyPair (production boot gates).
 * Static REQUIRED_IN_PRODUCTION checks live in phase-5-p0-hardening.test.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const envBackup: Record<string, string | undefined> = {};

function backupEnv(keys: string[]): void {
  for (const key of keys) {
    envBackup[key] = process.env[key];
  }
}

function restoreEnv(keys: string[]): void {
  for (const key of keys) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
}

const ENV_KEYS = [
  "NODE_ENV",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "ALLOWED_ORIGIN",
  "DB_CONFIG_ENCRYPTION_KEY",
  "CLERK_WEBHOOK_SECRET",
  "DATA_INTEGRITY_HEALTH_TOKEN",
  "PILOT_MODE",
  "ALLOW_EQUIPMENT_PILOT_MODE",
] as const;

describe("validateEnv runtime", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    backupEnv([...ENV_KEYS]);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv([...ENV_KEYS]);
    vi.restoreAllMocks();
  });

  function setProductionEnv(): void {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://vettrack:vettrack@localhost:5432/vettrack";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.SESSION_SECRET = "production-session-secret-not-in-list";
    process.env.ALLOWED_ORIGIN = "https://vettrack.example";
    process.env.CLERK_SECRET_KEY = "sk_live_test_key_for_validation";
    process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_live_test_key_for_validation";
    process.env.DB_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.CLERK_WEBHOOK_SECRET = "whsec_test";
    process.env.DATA_INTEGRITY_HEALTH_TOKEN = "health-token-test";
    process.env.DB_SSL_REJECT_UNAUTHORIZED = "true";
    process.env.S3_ACCESS_KEY_ID = "test-s3-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-s3-secret-key";
  }

  it("exits when Clerk publishable and secret keys are test/live mismatched", async () => {
    process.env.NODE_ENV = "production";
    process.env.VITE_CLERK_PUBLISHABLE_KEY = "pk_test_abc";
    process.env.CLERK_SECRET_KEY = "sk_live_xyz";
    process.env.DATABASE_URL = "postgres://localhost/vettrack";

    const { validateEnv } = await import("../server/lib/envValidation.js");
    validateEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits in production when CLERK_WEBHOOK_SECRET is missing", async () => {
    setProductionEnv();
    delete process.env.CLERK_WEBHOOK_SECRET;

    const { validateEnv } = await import("../server/lib/envValidation.js");
    validateEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits in production when DATA_INTEGRITY_HEALTH_TOKEN is missing", async () => {
    setProductionEnv();
    delete process.env.DATA_INTEGRITY_HEALTH_TOKEN;

    const { validateEnv } = await import("../server/lib/envValidation.js");
    validateEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("passes production validation when required secrets are present", async () => {
    setProductionEnv();

    const { validateEnv } = await import("../server/lib/envValidation.js");
    validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not enforce production required vars in development", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.REDIS_URL;
    delete process.env.CLERK_WEBHOOK_SECRET;

    const { validateEnv } = await import("../server/lib/envValidation.js");
    validateEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
