import { describe, it, expect, beforeAll } from "vitest";

let resolveAuthMode: (opts: Record<string, string | undefined>) => { mode: string; reason: string; hasSecret: boolean; hasPublishable?: boolean; nodeEnv?: string };
let resolveAuthModeFromEnv: (env: NodeJS.ProcessEnv) => { mode: string; reason: string; hasSecret: boolean; hasPublishable?: boolean; nodeEnv?: string };
let describeAuthMode: (result: { mode: string; reason: string; hasSecret: boolean; hasPublishable?: boolean; nodeEnv?: string }) => string;
let shouldMountClerkMiddleware: (env: NodeJS.ProcessEnv) => boolean;
let isProductionRuntime: (env: NodeJS.ProcessEnv) => boolean;

beforeAll(async () => {
  const mod = await import("../server/lib/auth-mode.ts");
  resolveAuthMode = mod.resolveAuthMode;
  resolveAuthModeFromEnv = mod.resolveAuthModeFromEnv;
  describeAuthMode = mod.describeAuthMode;
  shouldMountClerkMiddleware = mod.shouldMountClerkMiddleware;
  isProductionRuntime = mod.isProductionRuntime;
});

describe("auth-mode resolution", () => {
  it("dev bypass when nothing is set", () => {
    const empty = resolveAuthMode({});
    expect(empty.mode).toBe("dev-bypass");
    expect(empty.reason).toBe("secret-missing");
    expect(empty.hasSecret).toBe(false);
  });

  it("clerk mode when secret present", () => {
    const clerk = resolveAuthMode({ clerkSecretKey: "sk_test_abc" });
    expect(clerk.mode).toBe("clerk");
    expect(clerk.reason).toBe("secret-present");
    expect(clerk.hasSecret).toBe(true);
  });

  it("CLERK_ENABLED=false forces dev bypass even with a secret", () => {
    const disabled = resolveAuthMode({ clerkSecretKey: "sk_test_abc", clerkEnabled: "false" });
    expect(disabled.mode).toBe("dev-bypass");
    expect(disabled.reason).toBe("clerk-explicitly-disabled");
  });

  it("publishable key alone does not switch to clerk mode", () => {
    const pubOnly = resolveAuthMode({ vitePublishableKey: "pk_test_abc" });
    expect(pubOnly.mode).toBe("dev-bypass");
    expect(pubOnly.hasPublishable).toBe(true);
  });

  it("whitespace-only values are treated as unset", () => {
    const blanks = resolveAuthMode({ clerkSecretKey: "   ", clerkPublishableKey: "" });
    expect(blanks.mode).toBe("dev-bypass");
    expect(blanks.hasSecret).toBe(false);
    expect(blanks.hasPublishable).toBe(false);
  });

  it("resolveAuthModeFromEnv reads from the passed env bag", () => {
    const fromEnv = resolveAuthModeFromEnv({
      CLERK_SECRET_KEY: "sk_test_xyz",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    expect(fromEnv.mode).toBe("clerk");
    expect(fromEnv.hasPublishable).toBe(true);
    expect(fromEnv.nodeEnv).toBe("development");
  });

  it("describeAuthMode does not leak secret", () => {
    const fromEnv = resolveAuthModeFromEnv({
      CLERK_SECRET_KEY: "sk_test_xyz",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    const description = describeAuthMode(fromEnv);
    expect(!description.includes("sk_test_xyz")).toBeTruthy();
  });

  it("describeAuthMode includes mode=clerk", () => {
    const fromEnv = resolveAuthModeFromEnv({
      CLERK_SECRET_KEY: "sk_test_xyz",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    const description = describeAuthMode(fromEnv);
    expect(description.includes("mode=clerk")).toBeTruthy();
  });

  it("describeAuthMode includes hasSecret=true", () => {
    const fromEnv = resolveAuthModeFromEnv({
      CLERK_SECRET_KEY: "sk_test_xyz",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xyz",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);
    const description = describeAuthMode(fromEnv);
    expect(description.includes("hasSecret=true")).toBeTruthy();
  });

  it("shouldMountClerkMiddleware when auth mode is clerk", () => {
    expect(
      shouldMountClerkMiddleware({
        CLERK_SECRET_KEY: "sk_test_xyz",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("shouldMountClerkMiddleware on Railway production even when CLERK_ENABLED=false", () => {
    expect(
      shouldMountClerkMiddleware({
        CLERK_SECRET_KEY: "sk_live_xyz",
        CLERK_ENABLED: "false",
        NODE_ENV: "PORT 8080",
        RAILWAY_ENVIRONMENT: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("shouldMountClerkMiddleware is false for local dev bypass without secret", () => {
    expect(
      shouldMountClerkMiddleware({
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("isProductionRuntime treats Railway production as production", () => {
    expect(
      isProductionRuntime({
        NODE_ENV: "PORT 8080",
        RAILWAY_ENVIRONMENT: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
