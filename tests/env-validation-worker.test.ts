/**
 * Runtime tests for validateWorkerEnv — the production boot gate for `pnpm worker`
 * (server/workers/notification.worker.ts). Mirrors tests/env-validation-runtime.test.ts.
 *
 * The worker's required set differs from the API server's: it needs the push
 * credentials (APNs, FCM) that the API never touches, and it does not need the
 * publishable Clerk key or ALLOWED_ORIGIN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const envBackup: Record<string, string | undefined> = {};

function backupEnv(keys: readonly string[]): void {
  for (const key of keys) envBackup[key] = process.env[key];
}

function restoreEnv(keys: readonly string[]): void {
  for (const key of keys) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
}

const ENV_KEYS = [
  "NODE_ENV",
  "RAILWAY_ENVIRONMENT_NAME",
  "DATABASE_URL",
  "POSTGRES_URL",
  "REDIS_URL",
  "DB_SSL_REJECT_UNAUTHORIZED",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "APNS_KEY_P8",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "FCM_SERVICE_ACCOUNT_JSON",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
] as const;

function setProductionWorkerEnv(): void {
  process.env.NODE_ENV = "production";
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.DATABASE_URL = "postgres://vettrack:vettrack@localhost:5432/vettrack";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.DB_SSL_REJECT_UNAUTHORIZED = "true";
  process.env.S3_ACCESS_KEY_ID = "test-s3-access-key";
  process.env.S3_SECRET_ACCESS_KEY = "test-s3-secret-key";
  process.env.APNS_KEY_P8 = "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----";
  process.env.APNS_KEY_ID = "ABC123DEFG";
  process.env.APNS_TEAM_ID = "TEAM123456";
  process.env.APNS_BUNDLE_ID = "uk.vettrack.app";
  process.env.FCM_SERVICE_ACCOUNT_JSON = '{"project_id":"vettrack-a73ef"}';
  delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
}

describe("validateWorkerEnv runtime", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    backupEnv(ENV_KEYS);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv(ENV_KEYS);
    vi.restoreAllMocks();
  });

  it("passes in production when every worker-required variable is present", async () => {
    setProductionWorkerEnv();

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.each([
    "REDIS_URL",
    "DB_SSL_REJECT_UNAUTHORIZED",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "APNS_KEY_P8",
    "APNS_KEY_ID",
    "APNS_TEAM_ID",
    "APNS_BUNDLE_ID",
    "FCM_SERVICE_ACCOUNT_JSON",
  ])("exits in production when %s is missing, naming it", async (name) => {
    setProductionWorkerEnv();
    delete process.env[name];

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain(name);
  });

  it("exits in production when neither DATABASE_URL nor POSTGRES_URL is set", async () => {
    setProductionWorkerEnv();
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits when deployed on Railway with NODE_ENV unset — the gate must not be skippable by omission", async () => {
    setProductionWorkerEnv();
    delete process.env.NODE_ENV;

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("NODE_ENV");
  });

  it("does not require the API-only variables (publishable Clerk key, ALLOWED_ORIGIN)", async () => {
    setProductionWorkerEnv();
    delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
    delete process.env.ALLOWED_ORIGIN;

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("does not enforce anything in development", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.RAILWAY_ENVIRONMENT_NAME;
    delete process.env.REDIS_URL;
    delete process.env.APNS_KEY_P8;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("notification worker wiring (static)", () => {
  it("calls validateWorkerEnv() before any queue or push client is created", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "workers", "notification.worker.ts"),
      "utf8",
    );
    const bootstrapAt = source.indexOf('import "../lib/env-bootstrap.js";');
    const importAt = source.indexOf("validateWorkerEnv");
    const callAt = source.indexOf("validateWorkerEnv();");
    const mainAt = source.indexOf("async function main()");

    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(importAt).toBeGreaterThan(bootstrapAt);
    expect(callAt).toBeGreaterThan(importAt);
    expect(callAt).toBeLessThan(mainAt);
  });
});
