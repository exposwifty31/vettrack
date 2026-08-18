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
 * `x-dev-clinic-id-override` is a CLIENT-SUPPLIED header, so it is honored only
 * where `server/middleware/auth.ts` honors it: under BOTH `NODE_ENV !==
 * "production"` (auth.ts:159) and auth-mode dev-bypass (auth.ts:312), before it
 * reads the same header at auth.ts:317. `.cursorrules` records that contract —
 * dev-only headers are "honored only in dev bypass path". This middleware read
 * the header with no environment condition at all, four lines above an implicit
 * dev default that IS gated on NODE_ENV; that asymmetry inside one file, against
 * a sibling that double-gates the identical header, was an omission rather than
 * a design choice.
 *
 * Severity, stated precisely and not inflated: `tenantContext` is mounted at
 * server/index.ts:312, BEFORE any per-route `requireAuth`, so `req.authUser` is
 * usually unset and precedence can fall through to the header. But whenever
 * credentials resolve, `req.clinicId` is OVERWRITTEN from the session — globally
 * by `sessionContextMiddleware` one line later (server/index.ts:313 →
 * auth.ts:633) and again per-route by `requireAuth` (auth.ts:675/774/907). The
 * header value therefore survives only on requests whose credentials do NOT
 * resolve, reaching handlers that read `req.clinicId` without `requireAuth`.
 * This hint is best-effort by design (see the note below); end-to-end
 * exploitability was NOT demonstrated and is not claimed.
 *
 * It is worth gating anyway: the day `req.clinicId` sources a row-level-security
 * GUC, a client-supplied header would set DATABASE-ENFORCED tenant scope rather
 * than merely hinting at it. Closing this now is what makes that RLS work safe
 * to start later.
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
  const fromDevHeader = devClinicHeaderAllowed() && typeof rawDevHeader === "string"
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
