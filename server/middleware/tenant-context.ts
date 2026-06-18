import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db, users } from "../db.js";
import { readClerkUserSession } from "../lib/clerk-session-auth.js";

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
 * Best-effort clinic hint for downstream middleware. Does not reject requests:
 * parallel client fetches often run before the SPA attaches `Authorization`, so
 * `getAuth` may not see a user id even when `requireAuth` will succeed. Route
 * handlers use `requireAuth`, which always sets `req.clinicId` from the session.
 */
export async function tenantContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  const fromAuthUser = req.authUser?.clinicId;
  const fromDevHeader = typeof req.headers["x-dev-clinic-id-override"] === "string"
    ? req.headers["x-dev-clinic-id-override"]
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
