import type { Request } from "express";
import { getAuth } from "@clerk/express";

export interface ClerkUserSession {
  userId: string;
  orgId: string | null;
  sessionClaims: Record<string, unknown> | undefined;
}

/**
 * User/session JWT claims from Clerk. `acceptsToken: "any"` also matches machine
 * and API-key tokens that lack `userId` — narrow before reading session fields.
 */
export function readClerkUserSession(req: Request): ClerkUserSession | null {
  const auth = getAuth(req, { acceptsToken: "any" });
  if (!("userId" in auth) || !auth.userId || !("sessionClaims" in auth)) {
    return null;
  }
  return {
    userId: auth.userId,
    orgId: "orgId" in auth ? auth.orgId ?? null : null,
    sessionClaims: auth.sessionClaims as Record<string, unknown> | undefined,
  };
}
