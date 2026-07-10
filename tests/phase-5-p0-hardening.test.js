import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const repoRoot = path.resolve(__dirname, "..");
const envValidation = fs.readFileSync(path.join(repoRoot, "server", "lib", "envValidation.ts"), "utf8");
const serverIndex = fs.readFileSync(path.join(repoRoot, "server", "index.ts"), "utf8");
const healthRoutes = fs.readFileSync(path.join(repoRoot, "server", "routes", "health.ts"), "utf8");
const deployScript = fs.readFileSync(path.join(repoRoot, "deploy.sh"), "utf8");

describe("Phase 5 P0 hardening checks (static)", () => {
  it("Production env validation requires Redis and allowed origin", () => {
    expect(
      envValidation.includes("\"REDIS_URL\"") && envValidation.includes("\"ALLOWED_ORIGIN\""),
    ).toBe(true);
  });

  it("Production env validation requires Clerk webhook and data-integrity health token", () => {
    expect(envValidation).toContain("\"CLERK_WEBHOOK_SECRET\"");
    expect(envValidation).toContain("\"DATA_INTEGRITY_HEALTH_TOKEN\"");
    expect(envValidation).toMatch(/REQUIRED_IN_PRODUCTION[\s\S]*CLERK_WEBHOOK_SECRET/);
    expect(envValidation).toMatch(/REQUIRED_IN_PRODUCTION[\s\S]*DATA_INTEGRITY_HEALTH_TOKEN/);
  });

  it("Server defines production-aware CSP mode", () => {
    expect(serverIndex).toContain("const isProduction = isProductionRuntime()");
    expect(serverIndex).toContain("isProductionRuntime");
  });

  it("CSP only allows unsafe-eval outside production", () => {
    expect(serverIndex).toContain("...(isProduction ? [] : [\"'unsafe-eval'\"])");
  });

  it("CSP connect-src allows loopback only outside production", () => {
    const connectSrcBlock =
      serverIndex.match(/connectSrc:\s*\[([\s\S]*?)\],\s*\n\s*imgSrc:/)?.[1] ?? "";
    expect(connectSrcBlock).toMatch(
      /\.\.\.\(isProduction\s*\?\s*\[\]\s*:\s*\[[\s\S]*?"http:\/\/127\.0\.0\.1"[\s\S]*?"http:\/\/localhost"[\s\S]*?"ws:\/\/127\.0\.0\.1"[\s\S]*?"ws:\/\/localhost"[\s\S]*?\]\)/,
    );
    const beforeConnectSrc = serverIndex.slice(0, serverIndex.indexOf("connectSrc:"));
    expect(beforeConnectSrc).not.toContain('"http://127.0.0.1"');
    expect(beforeConnectSrc).not.toContain('"ws://localhost"');
  });

  it("Health router mounted at /api/health", () => {
    expect(serverIndex).toContain("app.use(\"/api/health\", healthRoutes);");
  });

  it("Health route exposes liveness/readiness/startup contracts", () => {
    expect(
      healthRoutes.includes("router.get(\"/live\"") &&
        healthRoutes.includes("type: \"liveness\"") &&
        healthRoutes.includes("router.get(\"/startup\"") &&
        healthRoutes.includes("type: \"startup\"") &&
        healthRoutes.includes("type: \"readiness\""),
    ).toBe(true);
  });

  it("Deploy preflight requires REDIS_URL", () => {
    expect(deployScript).toContain("\"REDIS_URL\"");
  });

  it("CI deploy job exports CLERK_WEBHOOK_SECRET and DATA_INTEGRITY_HEALTH_TOKEN", () => {
    const ciWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
    const deployJobStart = ciWorkflow.indexOf("\n  deploy:");
    const deployJobEnd = ciWorkflow.indexOf("\n  gate:");
    expect(deployJobStart).toBeGreaterThan(-1);
    expect(deployJobEnd).toBeGreaterThan(deployJobStart);
    const deployJob = ciWorkflow.slice(deployJobStart, deployJobEnd);
    expect(deployJob).toContain("run: bash deploy.sh --no-color");
    expect(deployJob).toContain("CLERK_WEBHOOK_SECRET: ${{ secrets.CLERK_WEBHOOK_SECRET }}");
    expect(deployJob).toContain("DATA_INTEGRITY_HEALTH_TOKEN: ${{ secrets.DATA_INTEGRITY_HEALTH_TOKEN }}");
  });

  it("deploy.sh declares the pilot-critical preflight vars", () => {
    expect(deployScript).toMatch(/pilot_required_vars=\("CLERK_WEBHOOK_SECRET" "DATA_INTEGRITY_HEALTH_TOKEN"\)/);
  });
});

describe("deploy.sh preflight (behavioral)", () => {
  const preflightEnv = {
    PATH: process.env.PATH,
    DATABASE_URL: "postgres://preflight-test",
    REDIS_URL: "redis://preflight-test",
    SESSION_SECRET: "preflight-test-secret",
    CLERK_SECRET_KEY: "sk_test_preflight",
    VITE_CLERK_PUBLISHABLE_KEY: "pk_test_preflight",
    ALLOWED_ORIGIN: "https://preflight.test",
    DB_CONFIG_ENCRYPTION_KEY: "preflight-test-key",
    CLERK_WEBHOOK_SECRET: "whsec_preflight",
    DATA_INTEGRITY_HEALTH_TOKEN: "token_preflight",
  };

  function runPreflight(env) {
    const result = spawnSync("bash", [path.join(repoRoot, "deploy.sh"), "--check", "--no-color"], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    // A timed-out spawn reports status null, which would satisfy `not.toBe(0)`
    // in the failure-path cases — surface it as an explicit error instead.
    if (result.error) throw result.error;
    return result;
  }

  it("passes with all required and pilot-critical vars present", () => {
    const result = runPreflight(preflightEnv);
    expect(result.status).toBe(0);
  });

  it.each(["CLERK_WEBHOOK_SECRET", "DATA_INTEGRITY_HEALTH_TOKEN"])(
    "fails with a validation message when %s is missing",
    (missing) => {
      const env = { ...preflightEnv };
      delete env[missing];
      const result = runPreflight(env);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain(`Required variable missing: ${missing}`);
    },
  );
});
