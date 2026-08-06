import type { Request } from "express";
import { getAuth } from "@clerk/express";

import { isAzpAllowed, resolveClerkAuthorizedParties } from "./clerk-authorized-parties.js";

export interface ClerkUserSession {
  userId: string;
  orgId: string | null;
  sessionClaims: Record<string, unknown> | undefined;
}

// Lazily resolved once per process (reads ALLOWED_ORIGIN after env-bootstrap).
let cachedAuthorizedParties: string[] | null = null;
function authorizedParties(): string[] {
  cachedAuthorizedParties ??= resolveClerkAuthorizedParties(process.env.NODE_ENV === "production");
  return cachedAuthorizedParties;
}

/**
 * User/session JWT claims from Clerk. `acceptsToken: "any"` also matches machine
 * and API-key tokens that lack `userId` — narrow before reading session fields.
 *
 * `azp` is enforced HERE (not via `clerkMiddleware({ authorizedParties })`):
 * @clerk/backend 3.x rejects tokens with an ABSENT `azp` when that option is set,
 * which 401s every native Expo/RN session token (they carry no browser origin).
 * `isAzpAllowed` keeps the 1.x semantics — absent azp passes, present azp must
 * be allowlisted — so browser/WebView tokens keep the cross-origin defence.
 */
export function readClerkUserSession(req: Request): ClerkUserSession | null {
  const auth = getAuth(req, { acceptsToken: "any" });
  if (!("userId" in auth) || !auth.userId || !("sessionClaims" in auth)) {
    return null;
  }
  const sessionClaims = auth.sessionClaims as Record<string, unknown> | undefined;
  const azp = sessionClaims?.azp;
  if (!isAzpAllowed(azp, authorizedParties())) {
    console.error(
      JSON.stringify({ event: "CLERK_AZP_REJECTED", azp, userId: auth.userId }),
    );
    return null;
  }
  return {
    userId: auth.userId,
    orgId: "orgId" in auth ? auth.orgId ?? null : null,
    sessionClaims,
  };
}
