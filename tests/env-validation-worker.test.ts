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

// The import-boundary test below imports the real worker entry. ESM evaluates every
// static import before the first statement runs, so the only way the gate can run
// BEFORE `../db.js` builds its Pool is for the entry to load the worker body lazily.
// These mocks record whether that boundary held; env-bootstrap is a no-op so a local
// .env cannot repair a deliberately broken environment.
let dbModuleEvaluated = false;
vi.mock("../server/db.js", () => {
  dbModuleEvaluated = true;
  return {};
});
vi.mock("../server/lib/env-bootstrap.js", () => ({}));

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
  "PGBOUNCER_URL",
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
  "ALLOWED_ORIGIN",
] as const;

function setProductionWorkerEnv(): void {
  process.env.NODE_ENV = "production";
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.env.DATABASE_URL = "postgres://vettrack:vettrack@localhost:5432/vettrack";
  delete process.env.POSTGRES_URL;
  delete process.env.PGBOUNCER_URL;
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
    dbModuleEvaluated = false;
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

  function printedErrors(): string {
    return errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
  }

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
    expect(printedErrors()).toContain(name);
  });

  it('boots but warns loudly when DB_SSL_REJECT_UNAUTHORIZED is "false" — the API gate (validateEnv) accepts the same value, so the worker must not be the only process that refuses it', async () => {
    // 2026-09-11 incident: production runs "false"; an exact-"true" check here crash-looped the Worker
    // while VetTrack stayed up on the identical variable. Presence stays required; the value is a
    // Railway-side fix (TASKS.md), after which BOTH gates tighten together.
    setProductionWorkerEnv();
    process.env.DB_SSL_REJECT_UNAUTHORIZED = "false";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).not.toHaveBeenCalled();
    const warned = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(warned).toContain("DB_SSL_REJECT_UNAUTHORIZED");
    expect(warned).toContain("certificate verification");
  });

  it("exits in production when no Postgres URL is set (DATABASE_URL, POSTGRES_URL, PGBOUNCER_URL)", async () => {
    setProductionWorkerEnv();
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.PGBOUNCER_URL;

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
    expect(printedErrors()).toContain("NODE_ENV");
  });

  it("does not take the production path on Railway when NODE_ENV is explicitly non-production", async () => {
    setProductionWorkerEnv();
    process.env.NODE_ENV = "development";
    delete process.env.APNS_KEY_P8;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;

    const { validateWorkerEnv } = await import("../server/lib/envValidation.js");
    validateWorkerEnv();

    expect(exitSpy).not.toHaveBeenCalled();
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

describe("notification worker import boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    dbModuleEvaluated = false;
    backupEnv(ENV_KEYS);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv(ENV_KEYS);
    vi.restoreAllMocks();
  });

  it("an invalid production environment stops the entry before ../db.js (and the rest of the worker body) is evaluated", async () => {
    setProductionWorkerEnv();
    delete process.env.APNS_KEY_P8;
    // The real process.exit never returns; make the test's stand-in behave the same way so
    // the entry cannot fall through to the dynamic import.
    vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    await expect(import("../server/workers/notification.worker.js")).rejects.toThrow("process.exit(1)");

    expect(dbModuleEvaluated).toBe(false);
  });

  it("source contract: the entry has no static imports beyond env-bootstrap and the gate, and loads the body dynamically after validateWorkerEnv()", () => {
    const source = fs.readFileSync(
      path.join(repoRoot, "server", "workers", "notification.worker.ts"),
      "utf8",
    );
    // `^import\s` — a static import statement; `import(` (the lazy body load) must not match.
    const staticImports = source.match(/^import\s.*$/gm) ?? [];
    expect(staticImports).toEqual([
      'import "../lib/env-bootstrap.js";',
      'import { validateWorkerEnv } from "../lib/envValidation.js";',
    ]);
    const callAt = source.indexOf("validateWorkerEnv();");
    const lazyAt = source.indexOf('import("./notification.worker.main.js")');
    expect(callAt).toBeGreaterThan(-1);
    expect(lazyAt).toBeGreaterThan(callAt);
  });
});
