/**
 * Deterministic local auth mode contract.
 *
 * Precedence (identical on client and server):
 *   - Clerk secret present AND CLERK_ENABLED !== "false"  => "clerk"
 *   - Otherwise                                           => "dev-bypass"
 *
 * Production enforces Clerk elsewhere (see envValidation + middleware).
 * This helper is used to keep client/server mode detection in sync and to
 * power preflight diagnostics without reading secrets.
 */

export type AuthMode = "clerk" | "dev-bypass";

export interface AuthModeInputs {
  clerkSecretKey?: string | null;
  clerkPublishableKey?: string | null;
  vitePublishableKey?: string | null;
  clerkEnabled?: string | null;
  nodeEnv?: string | null;
}

export interface AuthModeResolution {
  mode: AuthMode;
  reason:
    | "secret-present"
    | "secret-missing"
    | "clerk-explicitly-disabled";
  hasSecret: boolean;
  hasPublishable: boolean;
  nodeEnv: string;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveAuthMode(inputs: AuthModeInputs): AuthModeResolution {
  const hasSecret = nonEmpty(inputs.clerkSecretKey);
  const hasPublishable = nonEmpty(inputs.clerkPublishableKey) || nonEmpty(inputs.vitePublishableKey);
  const explicitlyDisabled = (inputs.clerkEnabled ?? "").trim().toLowerCase() === "false";
  const nodeEnv = (inputs.nodeEnv ?? "development").trim() || "development";

  if (explicitlyDisabled) {
    return { mode: "dev-bypass", reason: "clerk-explicitly-disabled", hasSecret, hasPublishable, nodeEnv };
  }
  if (hasSecret) {
    return { mode: "clerk", reason: "secret-present", hasSecret, hasPublishable, nodeEnv };
  }
  return { mode: "dev-bypass", reason: "secret-missing", hasSecret, hasPublishable, nodeEnv };
}

/**
 * Resolves the effective mode from process.env. Safe to call at any point;
 * does not mutate env. Intended for startup logging and preflight tooling.
 */
export function resolveAuthModeFromEnv(env: NodeJS.ProcessEnv = process.env): AuthModeResolution {
  return resolveAuthMode({
    clerkSecretKey: env.CLERK_SECRET_KEY,
    clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY,
    vitePublishableKey: env.VITE_CLERK_PUBLISHABLE_KEY,
    clerkEnabled: env.CLERK_ENABLED,
    nodeEnv: env.NODE_ENV,
  });
}

export function describeAuthMode(resolution: AuthModeResolution): string {
  return `mode=${resolution.mode} reason=${resolution.reason} env=${resolution.nodeEnv} hasSecret=${resolution.hasSecret} hasPublishable=${resolution.hasPublishable}`;
}

/** True when NODE_ENV=production or Railway production environment is active. */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? "development").trim();
  if (nodeEnv === "production") return true;
  return (env.RAILWAY_ENVIRONMENT ?? "").trim() === "production";
}

/**
 * Mount Clerk middleware whenever resolveAuthUser will call getAuth(req).
 * CLERK_ENABLED=false skips auth-mode "clerk" but production still has a secret
 * and must not call getAuth without clerkMiddleware (native Bearer bootstrap).
 */
export function shouldMountClerkMiddleware(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolution = resolveAuthModeFromEnv(env);
  if (resolution.mode === "clerk") return true;
  const hasSecret = Boolean(env.CLERK_SECRET_KEY?.trim());
  if (!hasSecret) return false;
  return isProductionRuntime(env);
}
