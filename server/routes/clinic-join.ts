import { Router, type Request, type Response } from "express";
import { randomUUID, randomBytes } from "crypto";
import { clerkClient } from "@clerk/express";
import { eq, and, isNull } from "drizzle-orm";
import { clinics, db, users } from "../db.js";
import { requireAuth, requireAdmin, sanitizeRequestedRole, sanitizeVetLicense } from "../middleware/auth.js";
import { authSensitiveLimiter } from "../middleware/rate-limiters.js";
import { readClerkUserSession } from "../lib/clerk-session-auth.js";
import { isAdminEmail } from "../lib/admin-email-allowlist.js";
import { logAudit } from "../lib/audit.js";
import { incrementMetric } from "../lib/metrics.js";
import { apiError } from "../lib/apiError.js";

/*
 * Clinic join codes — invite-free sign-up membership.
 *
 * POST /auth/join-clinic            any Clerk-authenticated identity (identity-only —
 *                                   deliberately NOT requireAuth: resolveAuthUser 403s
 *                                   MISSING_CLINIC_ID before a clinic-less user is
 *                                   provisioned, which is the dead end this breaks)
 * GET  /admin/clinic-join-code      admin-only  Current code (null = joining disabled)
 * POST /admin/clinic-join-code/rotate  admin-only  Generate/rotate the code
 *
 * A join code confers PENDING membership only: the provisioned row is
 * status "pending" / role "technician" (admin-email allowlist excepted,
 * mirroring resolveAuthUser's JIT block), so requireAuth blocks it from every
 * route until an admin approves. Role/status/clinic are never client-supplied.
 * Errors go through the i18n-aware `apiError()` envelope (per-locale).
 */

const router = Router();

const JOIN_CODE_SHAPE = /^[A-Z0-9]{8,32}$/;

/**
 * Normalize a client-supplied join code (trim + uppercase) down to the accepted
 * shape, or `null`. Malformed and unknown codes both surface as the same 404 so
 * the endpoint is not an enumeration oracle.
 */
export function sanitizeJoinCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return JOIN_CODE_SHAPE.test(normalized) ? normalized : null;
}

/** Unambiguous alphabet — no 0/O/1/I lookalikes; codes are typed by hand on phones. */
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 10;

export function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

function readMetadataField(meta: unknown, field: string): unknown {
  if (meta && typeof meta === "object") {
    return (meta as Record<string, unknown>)[field];
  }
  return undefined;
}

export async function handleJoinClinic(req: Request, res: Response): Promise<Response> {
  const session = readClerkUserSession(req);
  if (!session?.userId) {
    return apiError(req, res, "errors.clinicJoin.unauthorized", undefined, 401);
  }
  const clerkUserId = session.userId;

  const joinCode = sanitizeJoinCode((req.body as Record<string, unknown> | undefined)?.joinCode);
  if (!joinCode) {
    incrementMetric("auth_clinic_join_rejected");
    return apiError(req, res, "errors.clinicJoin.invalidCode", undefined, 404);
  }

  // tenant-lint:scoped membership-bootstrap lookup keyed by the globally-unique
  // join code; clinicId is the RESULT, not a filter (same pattern as the
  // display-token lookup in middleware/auth.ts).
  const [clinic] = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.signupJoinCode, joinCode))
    .limit(1);
  if (!clinic) {
    incrementMetric("auth_clinic_join_rejected");
    return apiError(req, res, "errors.clinicJoin.invalidCode", undefined, 404);
  }

  // An existing user (any clinic) is never re-homed by a join code — idempotent no-op.
  const [existing] = await db
    .select({ id: users.id, clinicId: users.clinicId, status: users.status })
    // tenant-lint:scoped auth-resolution lookup keyed by globally-unique clerkId; the caller has no clinic yet (same as resolveAuthUser's fallback branch)
    .from(users)
    .where(and(eq(users.clerkId, clerkUserId), isNull(users.deletedAt)))
    .limit(1);
  if (existing) {
    return res.status(200).json({ alreadyMember: true, status: existing.status });
  }

  let email = "";
  let name = "";
  let requestedRoleRaw: unknown;
  let vetLicenseRaw: unknown;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    email = clerkUser.emailAddresses?.[0]?.emailAddress ?? "";
    name = `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim();
    requestedRoleRaw = readMetadataField(clerkUser.unsafeMetadata, "requestedRole");
    vetLicenseRaw = readMetadataField(clerkUser.unsafeMetadata, "vetLicenseNumber");
  } catch (err) {
    console.error("[clinic-join] Clerk profile fetch failed", { clerkUserId, err });
    return apiError(req, res, "errors.clinicJoin.profileUnavailable", undefined, 503);
  }

  // Mirrors resolveAuthUser's JIT provisioning defaults exactly: role/status are
  // derived server-side, requestedRole/license are advisory staging columns.
  const adminEmail = email ? isAdminEmail(email) : false;
  const requestedRole = sanitizeRequestedRole(requestedRoleRaw);
  const vetLicenseNumber = requestedRole === "vet" ? sanitizeVetLicense(vetLicenseRaw) : null;

  const [inserted] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      clinicId: clinic.id,
      clerkId: clerkUserId,
      email,
      name,
      displayName: name || email,
      role: adminEmail ? "admin" : "technician",
      status: adminEmail ? "active" : "pending",
      requestedRole,
      vetLicenseNumber,
    })
    .onConflictDoNothing({ target: users.clerkId })
    .returning();

  if (!inserted) {
    // Concurrent join for the same identity won the race — fall back to the row it created.
    const [raced] = await db
      .select({ status: users.status })
      // tenant-lint:scoped auth-resolution lookup keyed by globally-unique clerkId (race fallback for the insert above)
      .from(users)
      .where(and(eq(users.clerkId, clerkUserId), isNull(users.deletedAt)))
      .limit(1);
    return res.status(200).json({ alreadyMember: true, status: raced?.status ?? "pending" });
  }

  logAudit({
    clinicId: clinic.id,
    actionType: "user_joined_via_clinic_code",
    performedBy: inserted.id,
    performedByEmail: email,
    targetId: inserted.id,
    targetType: "user",
    metadata: { source: "clinic_join_code", status: inserted.status },
  });
  incrementMetric("auth_clinic_join_succeeded");

  return res.status(200).json({ status: inserted.status });
}

router.post("/auth/join-clinic", authSensitiveLimiter, (req, res) => {
  handleJoinClinic(req, res).catch((err) => {
    console.error("[clinic-join] join-clinic failed", err);
    apiError(req, res, "errors.clinicJoin.joinFailed", undefined, 500);
  });
});

router.get("/admin/clinic-join-code", requireAuth, requireAdmin, async (req, res) => {
  try {
    // requireAuth populates req.clinicId before this handler runs; the Request
    // type cannot express that middleware-ordering contract.
    const clinicId = req.clinicId!;
    const [row] = await db
      .select({ signupJoinCode: clinics.signupJoinCode })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);
    return res.status(200).json({ joinCode: row?.signupJoinCode ?? null });
  } catch (err) {
    console.error("[clinic-join] read join code failed", err);
    return apiError(req, res, "errors.clinicJoin.codeReadFailed", undefined, 500);
  }
});

router.post("/admin/clinic-join-code/rotate", requireAuth, requireAdmin, authSensitiveLimiter, async (req, res) => {
  try {
    // requireAuth populates req.clinicId before this handler runs; the Request
    // type cannot express that middleware-ordering contract.
    const clinicId = req.clinicId!;

    // Retry on the (vanishingly unlikely) global-uniqueness collision.
    let joinCode: string | null = null;
    for (let attempt = 0; attempt < 3 && !joinCode; attempt++) {
      const candidate = generateJoinCode();
      try {
        await db
          .update(clinics)
          .set({ signupJoinCode: candidate, updatedAt: new Date() })
          .where(eq(clinics.id, clinicId));
        joinCode = candidate;
      } catch (err) {
        const pgCode = (err as { code?: string })?.code;
        if (pgCode !== "23505") throw err;
      }
    }
    if (!joinCode) {
      throw new Error("join code generation collided repeatedly");
    }

    logAudit({
      clinicId,
      actionType: "clinic_join_code_rotated",
      // requireAuth guarantees req.authUser is set before this handler runs;
      // the Request type cannot express that middleware-ordering contract.
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: clinicId,
      targetType: "clinic",
    });

    return res.status(200).json({ joinCode });
  } catch (err) {
    console.error("[clinic-join] rotate join code failed", err);
    return apiError(req, res, "errors.clinicJoin.codeRotateFailed", undefined, 500);
  }
});

export default router;
