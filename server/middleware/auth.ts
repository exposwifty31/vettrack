import type { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { getAuth, clerkClient } from "@clerk/express";
import { clinics, db, users } from "../db.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { STABILITY_TOKEN } from "../lib/stability-token.js";
import { resolveCurrentRole } from "../lib/role-resolution.js";
import { resolveRequestLocale } from "../../lib/i18n/middleware.js";
import { normalizeLocale } from "../../lib/i18n/loader.js";
import { buildAccessDeniedBody, recordAccessDenied } from "../lib/access-denied.js";
import { isAdminEmail } from "../lib/admin-email-allowlist.js";
import { incrementMetric } from "../lib/metrics.js";
import { resolveAuthModeFromEnv } from "../lib/auth-mode.js";

export type UserRole = "admin" | "vet" | "technician" | "senior_technician" | "student";
type LegacyUserRole = UserRole | "viewer";

export interface AuthUser {
  id: string;
  clerkId: string;
  email: string;
  name: string;
  role: UserRole;
  secondaryRole?: string | null;
  status: string;
  clinicId: string;
  locale?: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      effectiveRole?: string;
      roleSource?: string;
      activeShift?: unknown;
    }
  }
}

const ROLE_HIERARCHY: Record<string, number> = {
  admin: 40,
  vet: 30,
  senior_technician: 25,
  /** Alias roles used by Clerk/org metadata — must clear technician floor for forecast APIs */
  lead_technician: 22,
  vet_tech: 20,
  technician: 20,
  student: 10,
};

function normalizeUserRole(role: string | null | undefined): UserRole {
  const normalized = (role ?? "").trim().toLowerCase();
  // Backward compatibility for pre-migration values.
  if (normalized === "viewer") return "student";
  if (
    normalized === "admin" ||
    normalized === "vet" ||
    normalized === "technician" ||
    normalized === "senior_technician" ||
    normalized === "student"
  ) {
    return normalized;
  }
  return "student";
}

const DEV_USER: AuthUser = {
  id: "dev-admin-001",
  clerkId: "dev-admin-001",
  email: "admin@vettrack.dev",
  name: "Dev Admin",
  role: "admin",
  status: "active",
  clinicId: "dev-clinic-default",
};

const DEV_USER_PRESETS: Record<string, Partial<AuthUser>> = {
  "dev-user-alpha": { id: "dev-user-alpha", clerkId: "dev-user-alpha", email: "alpha@vettrack.dev", name: "Dev Alpha" },
  "dev-user-beta":  { id: "dev-user-beta",  clerkId: "dev-user-beta",  email: "beta@vettrack.dev",  name: "Dev Beta"  },
  "dev-pending-user-001": {
    id: "dev-pending-user-001",
    clerkId: "dev-pending-user-001",
    email: "pending@vettrack.dev",
    name: "Dev Pending",
    role: "technician",
    status: "pending",
  },
  "dev-blocked-user-001": {
    id: "dev-blocked-user-001",
    clerkId: "dev-blocked-user-001",
    email: "blocked@vettrack.dev",
    name: "Dev Blocked",
    role: "technician",
    status: "blocked",
  },
};

const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV !== "production";
const hasClerkSecret = Boolean(process.env.CLERK_SECRET_KEY?.trim());
const LEGACY_CLINIC_ID = "legacy-clinic";

/**
 * When Clerk omits org_id (common without Clerk Organizations), resolve clinic from the existing
 * DB user row. Enabled by default; set DB_CLINIC_FALLBACK=false to require org in the session.
 * ALLOW_DB_CLINIC_FALLBACK is accepted as an alias for DB_CLINIC_FALLBACK (same semantics).
 */
function allowDbClinicFallback(): boolean {
  const a = process.env.DB_CLINIC_FALLBACK?.trim().toLowerCase();
  const b = process.env.ALLOW_DB_CLINIC_FALLBACK?.trim().toLowerCase();
  return a !== "false" && b !== "false";
}

function authDebug(payload: Record<string, unknown>): void {
  const on = process.env.AUTH_DEBUG?.trim() === "1" || process.env.AUTH_DEBUG?.toLowerCase() === "true";
  if (!on) return;
  console.log(JSON.stringify({ event: "AUTH_DEBUG", ts: new Date().toISOString(), ...payload }));
}

/** Log-safe metadata only (no cookie values). */
function authRequestDebugCookieMeta(req: Request): { cookieHeaderLength: number; likelyClerkSessionCookie: boolean } {
  const raw = req.headers.cookie ?? "";
  return {
    cookieHeaderLength: raw.length,
    likelyClerkSessionCookie: /\b(__session|__clerk|__client)(=|;|$)/.test(raw),
  };
}

function isForbiddenProductionClinicId(clinicId: string | null | undefined): boolean {
  const c = clinicId?.trim() ?? "";
  if (!c) return true;
  return c === LEGACY_CLINIC_ID;
}

if (isProduction && !hasClerkSecret) {
  throw new Error("CLERK_SECRET_KEY is required in production. Refusing to start with dev auth bypass.");
}

async function ensureDevUserRecord(devUser: AuthUser): Promise<AuthUser> {
  await db
    .insert(clinics)
    .values({
      id: devUser.clinicId,
    })
    .onConflictDoNothing();

  const [row] = await db
    .insert(users)
    .values({
      id: devUser.id,
      clinicId: devUser.clinicId,
      clerkId: devUser.clerkId,
      email: devUser.email,
      name: devUser.name,
      displayName: devUser.name || devUser.email,
      role: devUser.role,
      status: devUser.status,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        clinicId: devUser.clinicId,
        email: devUser.email,
        name: devUser.name,
        displayName: devUser.name || devUser.email,
        role: devUser.role,
        status: devUser.status,
      },
    })
    .returning();

  return {
    id: row.id,
    clerkId: row.clerkId,
    email: row.email,
    name: row.name,
    role: normalizeUserRole(row.role),
    status: row.status,
    clinicId: devUser.clinicId,
  };
}

/**
 * Guarantees a vt_clinics row exists for `clerkOrgId` before we attempt
 * to insert/upsert a vt_users row that references it via FK.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING so concurrent first-logins for the
 * same org are safe and the operation is idempotent across retries.
 */
async function ensureClinicExistsForOrg(
  clerkOrgId: string,
): Promise<void> {
  await db
    .insert(clinics)
    .values({ id: clerkOrgId })
    .onConflictDoNothing();
}

export type ResolveResult =
  | { ok: true; user: AuthUser }
  | { ok: false; status: number; body: Record<string, string> };

export type AuthResolver = (req: Request) => Promise<ResolveResult>;

function resolveRequestId(req: Request, res: Response): string {
  const incoming = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"].trim() : "";
  const requestId = incoming || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

function buildApiErrorBody(params: {
  code: string;
  reason: string;
  message: string;
  requestId: string;
}): Record<string, string> {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
  };
}

function isLikelyInvalidTokenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("token") || msg.includes("jwt") || msg.includes("session");
}

const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export async function resolveAuthUser(req: Request): Promise<ResolveResult> {
  if (req.headers["x-stability-token"] === STABILITY_TOKEN) {
    if (process.env.NODE_ENV === "production") {
      const remote = req.socket?.remoteAddress ?? req.ip ?? "";
      if (!LOOPBACK_ADDRS.has(remote)) {
        return {
          ok: false,
          status: 403,
          body: { error: "FORBIDDEN", reason: "STABILITY_TOKEN_EXTERNAL_ORIGIN", message: "Forbidden" },
        };
      }
    }
    return { ok: true, user: { ...DEV_USER, role: "admin" } };
  }

  const isDevBypass = isDevelopment && resolveAuthModeFromEnv().mode === "dev-bypass";

  if (isDevBypass) {
    const overrideRole = req.headers["x-dev-role-override"] as LegacyUserRole | undefined;
    const overrideUserId = req.headers["x-dev-user-id-override"] as string | undefined;
    const overrideClinicId = req.headers["x-dev-clinic-id-override"] as string | undefined;
    const userPreset = overrideUserId ? DEV_USER_PRESETS[overrideUserId] : undefined;
    const baseUser: AuthUser = userPreset ? { ...DEV_USER, ...userPreset } : DEV_USER;
    const clinicId = (overrideClinicId ?? process.env.DEV_DEFAULT_CLINIC_ID ?? DEV_USER.clinicId).trim();
    const tenantUser: AuthUser = { ...baseUser, clinicId };
    const devUser: AuthUser = overrideRole
      ? { ...tenantUser, role: normalizeUserRole(overrideRole) }
      : tenantUser;
    const resolved = await ensureDevUserRecord(devUser);
    return { ok: true, user: resolved };
  }

  let clerkUserId: string | null | undefined;
  let clerkOrgId: string | null | undefined;
  let sessionClaims: Record<string, unknown> | undefined;
  try {
    const auth = getAuth(req, { acceptsToken: "any" });
    clerkUserId = auth.userId;
    clerkOrgId = auth.orgId;
    sessionClaims = auth.sessionClaims as Record<string, unknown> | undefined;
  } catch (err) {
    console.error("[auth] Failed to read auth session", err);
    return { ok: false, status: 401, body: { error: "UNAUTHORIZED", reason: "INVALID_AUTH_TOKEN", message: "Invalid authentication token" } };
  }

  const fallbackAllowed = allowDbClinicFallback();
  const authz = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  authDebug({
    step: "session_claims",
    clerkUserId: clerkUserId ?? null,
    clerkOrgId: clerkOrgId ?? null,
    dbClinicFallbackEnabled: fallbackAllowed,
    ...authRequestDebugCookieMeta(req),
    authorizationBearerPresent: Boolean(authz && /^Bearer\s+\S+/i.test(authz)),
  });

  if (!clerkUserId) {
    return { ok: false, status: 401, body: { error: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized" } };
  }
  if (!clerkOrgId) {
    if (!fallbackAllowed) {
      console.error(
        JSON.stringify({
          event: "DB_FALLBACK_DISABLED",
          clerkUserId,
          production: isProduction,
        }),
      );
      return {
        ok: false,
        status: 403,
        body: buildAccessDeniedBody(
          "DB_FALLBACK_DISABLED",
          "Clinic context is required; database clinic fallback is not enabled for this environment",
        ),
      };
    }

    const [existingUser] = await db
      .select({
        clinicId: users.clinicId,
        id: users.id,
      })
      .from(users)
      .where(and(eq(users.clerkId, clerkUserId), isNull(users.deletedAt)))
      .limit(1);

    authDebug({
      step: "db_fallback_no_org",
      clerkUserId,
      found: Boolean(existingUser),
      dbUserId: existingUser?.id ?? null,
      dbClinicId: existingUser?.clinicId ?? null,
    });

    if (existingUser?.clinicId) {
      clerkOrgId = existingUser.clinicId;
      console.warn("[auth] Clerk org missing; using clinic from existing DB user", {
        clerkUserId,
        dbUserId: existingUser.id,
        clinicId: clerkOrgId,
      });
    } else {
      return {
        ok: false,
        status: 403,
        body: buildAccessDeniedBody("MISSING_CLINIC_ID", "User is not assigned to a clinic"),
      };
    }
  }

  if (isProduction && isForbiddenProductionClinicId(clerkOrgId)) {
    console.error(
      JSON.stringify({
        event: "CRITICAL_MISSING_CLINIC",
        clerkUserId,
        resolvedClinicId: clerkOrgId ?? null,
        reason: "legacy_or_empty",
      }),
    );
    return {
      ok: false,
      status: 403,
      body: buildAccessDeniedBody("MISSING_CLINIC_ID", "User is not assigned to a valid clinic"),
    };
  }

  let clerkEmail = (sessionClaims?.email as string | undefined) ?? "";
  let clerkName = (sessionClaims?.name as string | undefined) ?? "";
  const clerkLocaleClaim =
    (sessionClaims?.locale as string | undefined) ??
    (sessionClaims?.["https://clerk.dev/locale"] as string | undefined);
  const clerkLocale = normalizeLocale(clerkLocaleClaim);
  if (!clerkEmail) {
    try {
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      clerkEmail = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
      clerkName = `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim();
    } catch (err) {
      console.error("[auth] Clerk profile enrichment failed for new-user bootstrap", { clerkUserId, err });
      incrementMetric("auth_clerk_profile_fetch_failed");
      return {
        ok: false,
        status: 503,
        body: buildAccessDeniedBody("AUTH_PROFILE_UNAVAILABLE", "Unable to verify account profile; please retry sign-in"),
      };
    }
  }

  const adminEmail = clerkEmail ? isAdminEmail(clerkEmail) : false;
  const defaultStatus = adminEmail ? "active" : "pending";
  const defaultRole: UserRole = adminEmail ? "admin" : "technician";

  // Guarantee the clinic row exists before inserting the user. A new Clerk
  // organization has no matching vt_clinics row until this fires; without it
  // the user insert violates the vt_users_clinic_id_fk FK constraint.
  await ensureClinicExistsForOrg(clerkOrgId);

  // SECURITY: Role is ALWAYS resolved from the database record.
  // The onConflictDoUpdate set clause deliberately excludes `role` so that
  // a user whose role was downgraded mid-session cannot retain elevated access
  // on their next authenticated request.
  let [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      clinicId: clerkOrgId,
      clerkId: clerkUserId,
      email: clerkEmail,
      name: clerkName,
      displayName: clerkName || clerkEmail,
      role: defaultRole,
      status: defaultStatus,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        email: sql`CASE WHEN EXCLUDED.email = '' THEN ${users.email} ELSE EXCLUDED.email END`,
        name: sql`CASE WHEN EXCLUDED.name = '' THEN ${users.name} ELSE EXCLUDED.name END`,
        displayName: sql`CASE WHEN ${users.displayName} = '' AND EXCLUDED.display_name != '' THEN EXCLUDED.display_name ELSE ${users.displayName} END`,
      },
    })
    .returning();

  if (user.deletedAt) {
    return { ok: false, status: 403, body: { error: "ACCESS_DENIED", reason: "ACCOUNT_DELETED", message: "Your account has been removed." } };
  }

  if (isProduction && isForbiddenProductionClinicId(user.clinicId)) {
    console.error(
      JSON.stringify({
        event: "CRITICAL_MISSING_CLINIC",
        clerkUserId,
        userId: user.id,
        resolvedClinicId: user.clinicId,
        reason: "legacy_or_empty_db_user",
      }),
    );
    return {
      ok: false,
      status: 403,
      body: buildAccessDeniedBody("MISSING_CLINIC_ID", "User is not assigned to a valid clinic"),
    };
  }

  if (user.clinicId !== clerkOrgId) {
    if (fallbackAllowed) {
      // Without Clerk Organizations, sessions may still carry an org/clinic claim that does not
      // match the DB row; upsert does not overwrite clinicId on conflict, so DB remains authoritative.
      console.warn("[auth] Session org/clinic differs from DB; using DB clinic (DB_CLINIC_FALLBACK enabled)", {
        clerkUserId,
        sessionClinicOrOrg: clerkOrgId,
        dbClinicId: user.clinicId,
      });
    } else {
      authDebug({
        step: "tenant_mismatch",
        clerkUserId,
        sessionClinicOrOrg: clerkOrgId,
        dbClinicId: user.clinicId,
      });
      return {
        ok: false,
        status: 403,
        body: buildAccessDeniedBody("TENANT_MISMATCH", "Authenticated clinic does not match user clinic assignment"),
      };
    }
  }

  authDebug({
    step: "resolve_ok",
    clerkUserId,
    resolvedClinicId: user.clinicId,
    userStatus: user.status,
    userId: user.id,
  });

  return {
    ok: true,
    user: {
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      name: user.name,
      role: normalizeUserRole(user.role),
      secondaryRole: user.secondaryRole ?? null,
      status: user.status,
      clinicId: user.clinicId,
      locale: clerkLocale,
    },
  };
}

/**
 * Best-effort session attachment for global `/api` middleware registered before route-level `requireAuth`.
 * Populates `req.authUser` and `req.clinicId` when credentials resolve so downstream middleware
 * (e.g. ER Mode Concealment 404) can scope clinic policy without spurious errors.
 * Does not send 401/403 — unauthenticated requests continue; routes still use `requireAuth` where required.
 */
export async function sessionContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await resolveAuthUser(req);
    if (result.ok) {
      req.authUser = result.user;
      req.clinicId = result.user.clinicId;
      req.locale = resolveRequestLocale(req, result.user.locale);
      Sentry.setUser({ id: result.user.id, email: result.user.email });
    }
  } catch (err) {
    console.error("[auth] sessionContextMiddleware failed (fail-open)", err);
  }
  next();
}

export function createRequireAuth(resolver: AuthResolver = resolveAuthUser) {
  return async function requireAuthHandler(req: Request, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req, res);
    try {
      const result = await resolver(req);
      if (!result.ok) {
        const bodyWithRequestId = { ...result.body, requestId };
        if (result.status === 403 && typeof result.body.reason === "string") {
          const reason = result.body.reason;
          if (
            reason === "MISSING_CLINIC_ID" ||
            reason === "DB_FALLBACK_DISABLED" ||
            reason === "TENANT_MISMATCH" ||
            reason === "ACCOUNT_PENDING_APPROVAL" ||
            reason === "ACCOUNT_BLOCKED" ||
            reason === "ACCOUNT_DELETED" ||
            reason === "TENANT_CONTEXT_MISSING" ||
            reason === "INSUFFICIENT_ROLE"
          ) {
            recordAccessDenied({
              req,
              source: "requireAuth",
              statusCode: result.status,
              reason,
              message: result.body.message,
            });
          }
        }
        return res.status(result.status).json(bodyWithRequestId);
      }

      req.authUser = result.user;
      req.clinicId = result.user.clinicId;
      req.locale = resolveRequestLocale(req, result.user.locale);
      Sentry.setUser({ id: result.user.id, email: result.user.email });

      if (result.user.status === "pending") {
        recordAccessDenied({
          req,
          source: "requireAuth",
          statusCode: 403,
          reason: "ACCOUNT_PENDING_APPROVAL",
          clinicId: result.user.clinicId,
          userId: result.user.id,
          message: "Account pending approval",
        });
        if (process.env.AUTH_DEBUG?.trim() === "1" || process.env.AUTH_DEBUG?.toLowerCase() === "true") {
          console.log(
            JSON.stringify({
              event: "AUTH_DEBUG",
              ts: new Date().toISOString(),
              step: "requireAuth_pending_block",
              userId: result.user.id,
              clerkId: result.user.clerkId,
              clinicId: result.user.clinicId,
            }),
          );
        }
        return res.status(403).json({
          ...buildAccessDeniedBody("ACCOUNT_PENDING_APPROVAL", "Account pending approval"),
          requestId,
        });
      }

      if (result.user.status === "blocked") {
        recordAccessDenied({
          req,
          source: "requireAuth",
          statusCode: 403,
          reason: "ACCOUNT_BLOCKED",
          clinicId: result.user.clinicId,
          userId: result.user.id,
          message: "Your account has been suspended.",
        });
        return res.status(403).json({
          ...buildAccessDeniedBody("ACCOUNT_BLOCKED", "Your account has been suspended."),
          requestId,
        });
      }

      next();
    } catch (err) {
      const status = isLikelyInvalidTokenError(err) ? 401 : 500;
      const message = status === 401 ? "Invalid authentication token" : "Auth failed";
      console.error("[auth] requireAuth error", err);
      return res.status(status).json(
        buildApiErrorBody({
          code: status === 401 ? "UNAUTHORIZED" : "AUTH_FAILED",
          reason: status === 401 ? "INVALID_AUTH_TOKEN" : "AUTH_HANDLER_ERROR",
          message,
          requestId,
        }),
      );
    }
  };
}

export const requireAuth = createRequireAuth();

export function createRequireAuthAny(resolver: AuthResolver = resolveAuthUser) {
  return async function requireAuthAnyHandler(req: Request, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req, res);
    try {
      const result = await resolver(req);
      if (!result.ok) {
        const bodyWithRequestId = { ...result.body, requestId };
        if (result.status === 403 && typeof result.body.reason === "string") {
          const reason = result.body.reason;
          if (
            reason === "MISSING_CLINIC_ID" ||
            reason === "DB_FALLBACK_DISABLED" ||
            reason === "TENANT_MISMATCH" ||
            reason === "ACCOUNT_PENDING_APPROVAL" ||
            reason === "ACCOUNT_BLOCKED" ||
            reason === "ACCOUNT_DELETED" ||
            reason === "TENANT_CONTEXT_MISSING" ||
            reason === "INSUFFICIENT_ROLE"
          ) {
            recordAccessDenied({
              req,
              source: "requireAuthAny",
              statusCode: result.status,
              reason,
              message: result.body.message,
            });
          }
        }
        return res.status(result.status).json(bodyWithRequestId);
      }

      req.authUser = result.user;
      req.clinicId = result.user.clinicId;
      req.locale = resolveRequestLocale(req, result.user.locale);
      Sentry.setUser({ id: result.user.id, email: result.user.email });
      next();
    } catch (err) {
      const status = isLikelyInvalidTokenError(err) ? 401 : 500;
      const message = status === 401 ? "Invalid authentication token" : "Auth failed";
      console.error("[auth] requireAuthAny error", err);
      return res.status(status).json(
        buildApiErrorBody({
          code: status === 401 ? "UNAUTHORIZED" : "AUTH_FAILED",
          reason: status === 401 ? "INVALID_AUTH_TOKEN" : "AUTH_HANDLER_ERROR",
          message,
          requestId,
        }),
      );
    }
  };
}

export const requireAuthAny = createRequireAuthAny();

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = resolveRequestId(req, res);
  if (!req.authUser) {
    return res.status(401).json(
      buildApiErrorBody({
        code: "UNAUTHORIZED",
        reason: "MISSING_AUTH_USER",
        message: "Unauthorized",
        requestId,
      }),
    );
  }
  if (req.authUser.role !== "admin") {
    recordAccessDenied({
      req,
      source: "requireAdmin",
      statusCode: 403,
      reason: "INSUFFICIENT_ROLE",
      message: "Admin access required",
    });
    return res.status(403).json({
      ...buildAccessDeniedBody("INSUFFICIENT_ROLE", "Admin access required"),
      requestId,
    });
  }
  next();
}


const CLINICAL_ROLES = new Set(["admin", "vet", "senior_technician", "technician"]);

export function requireClinicalUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(req, res);
  if (!req.authUser) {
    res.status(401).json(buildApiErrorBody({ code: "UNAUTHORIZED", reason: "MISSING_AUTH_USER", message: "Unauthorized", requestId }));
    return;
  }
  if (!CLINICAL_ROLES.has(req.authUser.role)) {
    recordAccessDenied({ req, source: "requireClinicalUser", statusCode: 403, reason: "INSUFFICIENT_ROLE", message: "Clinical role required" });
    res.status(403).json({ ...buildAccessDeniedBody("INSUFFICIENT_ROLE", "Clinical role required"), requestId });
    return;
  }
  next();
}

export function requireEffectiveRole(minRole: UserRole) {
  return async function (req: Request, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req, res);
    if (!req.authUser) {
      return res.status(401).json(
        buildApiErrorBody({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    try {
      const { effectiveRole, source, activeShift } = await resolveCurrentRole({
        clinicId: req.clinicId!,
        userId: req.authUser.id,
        userName: req.authUser.name,
        fallbackRole: req.authUser.role,
        secondaryRole: req.authUser.secondaryRole ?? null,
      });
      req.effectiveRole = effectiveRole;
      req.roleSource = source;
      req.activeShift = activeShift;

      if (process.env.NODE_ENV !== "production") {
        console.log("Role check:", {
          user: req.authUser.name,
          dbRole: req.authUser.role,
          effectiveRole,
          source,
        });
      }

      if (req.authUser.role === "admin" || req.authUser.secondaryRole === "admin") {
        return next();
      }

      const userLevel = ROLE_HIERARCHY[effectiveRole] ?? 0;
      const requiredLevel = ROLE_HIERARCHY[minRole] ?? 0;
      if (userLevel < requiredLevel) {
        recordAccessDenied({
          req,
          source: "requireEffectiveRole",
          statusCode: 403,
          reason: "INSUFFICIENT_ROLE",
          message: "Insufficient permissions",
        });
        return res.status(403).json({
          ...buildAccessDeniedBody("INSUFFICIENT_ROLE", "Insufficient permissions"),
          requestId,
        });
      }

      next();
    } catch (err) {
      console.error("requireEffectiveRole:", err);
      return res.status(500).json(
        buildApiErrorBody({
          code: "INTERNAL_ERROR",
          reason: "ROLE_RESOLUTION_FAILED",
          message: "Role resolution failed",
          requestId,
        }),
      );
    }
  };
}
