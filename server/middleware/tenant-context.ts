import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, users } from "../db.js";
import { readClerkUserSession } from "../lib/clerk-session-auth.js";
import { resolveAuthModeFromEnv } from "../lib/auth-mode.js";

export interface AuthenticatedRequest extends Request {
  clinicId: string;
}

declare global {
  namespace Express {
    interface Request {
      clinicId?: string;
    }
  }
}

/**
 * `x-dev-clinic-id-override` is client-supplied, so it is honored only where
 * `server/middleware/auth.ts` honors it: non-production AND auth-mode
 * dev-bypass. One rule for one header, across both middlewares — the contract
 * `.cursorrules:26` states in words.
 *
 * Gated even though this hint is best-effort and overwritten from the session
 * downstream: the day `req.clinicId` sources a row-level-security GUC, a
 * client-supplied header would set database-enforced tenant scope rather than
 * merely hinting at it.
 *
 * Full threat model, blast radius and the options rejected: ADR-010.
 */
function devClinicHeaderAllowed(): boolean {
  return process.env.NODE_ENV !== "production"
    && resolveAuthModeFromEnv().mode === "dev-bypass";
}

/**
 * Best-effort clinic hint for downstream middleware. Does not reject requests:
 * parallel client fetches often run before the SPA attaches `Authorization`, so
 * `getAuth` may not see a user id even when `requireAuth` will succeed. Route
 * handlers use `requireAuth`, which always sets `req.clinicId` from the session.
 */
export async function tenantContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  const fromAuthUser = req.authUser?.clinicId;
  const rawDevHeader = req.headers["x-dev-clinic-id-override"];
  // Header presence is checked FIRST: `tenantContext` runs on every /api
  // request and most requests omit this header, so resolving the auth mode
  // ahead of the cheap type check would allocate a resolution object to answer
  // a question that is usually already moot.
  const fromDevHeader = typeof rawDevHeader === "string" && devClinicHeaderAllowed()
    ? rawDevHeader
    : undefined;
  const fromDevDefault = process.env.DEV_DEFAULT_CLINIC_ID;
  const fromImplicitDevDefault = process.env.NODE_ENV !== "production" ? "dev-clinic-default" : undefined;
  let clerkUserId: string | undefined;
  const fromClerk = (() => {
    try {
      const session = readClerkUserSession(req);
      clerkUserId = session?.userId;
      return session?.orgId ?? undefined;
    } catch {
      return undefined;
    }
  })();

  let inferredFromDb: string | undefined;
  if (!fromAuthUser && !fromClerk && clerkUserId) {
    try {
      const [existingUser] = await db
        .select({ clinicId: users.clinicId })
        .from(users)
        .where(and(eq(users.clerkId, clerkUserId), isNull(users.deletedAt)))
        .limit(1);
      inferredFromDb = existingUser?.clinicId ?? undefined;
    } catch (error) {
      console.warn("[tenant-context] Failed to infer clinic from DB user", {
        clerkUserId,
        error,
      });
    }
  }

  const clinicId = (fromAuthUser ?? fromClerk ?? inferredFromDb ?? fromDevHeader ?? fromDevDefault ?? fromImplicitDevDefault)?.trim();
  if (clinicId) {
    req.clinicId = clinicId;
  }
  next();
}

export function requireClinicId(req: Request): string {
  const clinicId = req.clinicId?.trim();
  if (!clinicId) {
    throw new Error("Missing clinicId in request context");
  }
  return clinicId;
}
