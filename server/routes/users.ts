// TODO(arch): file exceeds 1100 lines. Split into handler modules following
// the equipment-route-utils.ts / handlers/ pattern already started in this directory.
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, users } from "../db.js";
import { eq, sql, isNull, and } from "drizzle-orm";
import { requireAuth, requireAuthAny, requireAdmin } from "../middleware/auth.js";
import { clerkClient } from "@clerk/express";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { authSensitiveLimiter } from "../middleware/rate-limiters.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { invalidateForUser } from "../lib/authority-cache.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { getUsersMeHandler } from "./users/handlers/get-users-me.js";
import { getUsersMeShiftActivityHandler } from "./users/handlers/get-users-me-shift-activity.js";
import { getUsersDeletedHandler } from "./users/handlers/get-users-deleted.js";
import { getUsersListHandler } from "./users/handlers/get-users-list.js";
import { patchUserSecondaryRoleHandler } from "./users/handlers/patch-user-secondary-role.js";
import { patchUserEquipmentCoordinatorHandler } from "./users/handlers/patch-user-equipment-coordinator.js";
import { patchUserSeniorDoctorEligibleHandler } from "./users/handlers/patch-user-senior-doctor-eligible.js";
import { patchUserStatusHandler } from "./users/handlers/patch-user-status.js";
import { patchUserDisplayNameHandler } from "./users/handlers/patch-user-display-name.js";
import { patchUserRestoreHandler } from "./users/handlers/patch-user-restore.js";
import { getUsersManagersHandler } from "./users/handlers/get-users-managers.js";
import { postUserAppleLinkHandler } from "./users/handlers/post-user-apple-link.js";
import { deleteUserAccountHandler } from "./users/handlers/delete-user-account.js";
import { getUsersPurgeCandidatesHandler } from "./users/handlers/get-users-purge-candidates.js";
import { postUsersPurgeDeletedHandler } from "./users/handlers/post-users-purge-deleted.js";
import { patchUserRoleHandler } from "./users/handlers/patch-user-role.js";
import { patchUserDeleteHandler } from "./users/handlers/patch-user-delete.js";

/*
 * PERMISSIONS MATRIX — /api/users
 * ─────────────────────────────────────────────────────
 * GET   /me          student+    Current authenticated user's profile
 * GET   /            admin-only  List all users
 * PATCH /:id/role    admin-only  Change a user's role
 * POST  /sync        student+    Sync Clerk identity to DB record
 * PATCH /:id/equipment-coordinator   admin-only   Set/clear Equipment Coordinator eligibility
 * PATCH /:id/senior-doctor-eligible  admin-only   Set/clear senior-doctor eligibility (doctor shift gate)
 * ─────────────────────────────────────────────────────
 * Role is always resolved from the DB record — never from request
 * headers, body, or JWT claims.
 */

const router = Router();

const userFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  displayName: users.displayName,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
};

const VALID_ROLES = ["admin", "vet", "technician", "senior_technician", "student"] as const;
const VALID_STATUSES = ["pending", "active", "blocked"] as const;

const patchRoleSchema = z.object({
  role: z.enum(VALID_ROLES, { required_error: "role is required" }),
});

const patchStatusSchema = z.object({
  status: z.enum(VALID_STATUSES, { required_error: "status is required" }),
  // Optional role to grant on approval (pending → active). Omitted: the user's
  // self-requested role is auto-applied. Provided: admin override wins (C3).
  role: z.enum(VALID_ROLES).optional(),
});

const patchDisplayNameSchema = z.object({
  display_name: z.string().trim().min(1, "display_name is required").max(60, "display_name is too long"),
});

const syncUserSchema = z.object({
  clerkId: z.string().min(1, "clerkId is required"),
  email: z.string().email("email must be a valid email address"),
  name: z.string().optional(),
});

function normalizeIdentityValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isDemoIdentity(clerkId: string, email: string, name: string): boolean {
  const id = clerkId.toLowerCase();
  const em = email.toLowerCase();
  const nm = name.toLowerCase();
  const local = em.includes("@") ? em.split("@")[0] : em;

  return (
    id.startsWith("demo") ||
    id.includes("demo-") ||
    local.startsWith("demo") ||
    local.includes("+demo") ||
    nm.includes("demo")
  );
}

function serializeUser(user: typeof users.$inferSelect) {
  return {
    ...user,
  };
}

router.get("/me", requireAuth, getUsersMeHandler);

router.get("/me/shift-activity", requireAuth, getUsersMeShiftActivityHandler);

router.get("/deleted", requireAuth, requireAdmin, getUsersDeletedHandler);

router.get("/", requireAuth, requireAdmin, getUsersListHandler);

router.get("/pending", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const pendingUsers = await db
      // requestedRole is the self-requested role (C3): the admin verifies the
      // vet license below, then approval auto-applies the requested role.
      .select({
        ...userFields,
        requestedRole: users.requestedRole,
        vetLicenseNumber: users.vetLicenseNumber,
      })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.status, "pending"), isNull(users.deletedAt)))
      .orderBy(users.createdAt);
    res.json(pendingUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_LIST_PENDING_FAILED",
        message: "Failed to list pending users",
        requestId,
      }),
    );
  }
});

router.patch("/:id/role", requireAuth, requireAdmin, validateUuid("id"), validateBody(patchRoleSchema), patchUserRoleHandler);

const patchSecondaryRoleSchema = z.object({
  secondaryRole: z.enum(["technician", "senior_technician", "admin"]).nullable(),
});

router.patch("/:id/secondary-role", requireAuth, requireAdmin, validateUuid("id"), validateBody(patchSecondaryRoleSchema), patchUserSecondaryRoleHandler);

const patchEquipmentCoordinatorSchema = z.object({
  isEquipmentCoordinator: z.boolean(),
});

/**
 * PATCH /api/users/:id/equipment-coordinator
 *
 * P3 T3.4-i-a — admin sets/clears a user's Equipment Coordinator
 * eligibility (`vt_users.is_equipment_coordinator`). Static and
 * manager-set — distinct from `secondaryRole` (a single-valued
 * authority-elevation field); which eligible tech is coordinator for a
 * given shift is derived separately, never stored on this row.
 */
router.patch(
  "/:id/equipment-coordinator",
  requireAuth,
  requireAdmin,
  validateUuid("id"),
  validateBody(patchEquipmentCoordinatorSchema),
  patchUserEquipmentCoordinatorHandler,
);

const patchSeniorDoctorEligibleSchema = z.object({
  seniorDoctorEligible: z.boolean(),
});

/**
 * PATCH /api/users/:id/senior-doctor-eligible
 *
 * Doctor shift gate (spec 2026-08-13) — admin sets/clears a user's
 * static eligibility to mark themselves as the responsible senior of a
 * doctor team at check-in (`vt_users.senior_doctor_eligible`). Mirrors
 * the equipment-coordinator eligibility handler. Which team a senior
 * leads is chosen per check-in, never stored on this row. Distinct from
 * `secondaryRole` (account RBAC — never consulted by the clinical path).
 */
router.patch(
  "/:id/senior-doctor-eligible",
  requireAuth,
  requireAdmin,
  validateUuid("id"),
  validateBody(patchSeniorDoctorEligibleSchema),
  patchUserSeniorDoctorEligibleHandler,
);

router.patch("/:id/status", requireAuth, requireAdmin, validateUuid("id"), validateBody(patchStatusSchema), patchUserStatusHandler);

router.patch("/:id/display_name", requireAuthAny, validateUuid("id"), validateBody(patchDisplayNameSchema), patchUserDisplayNameHandler);

router.patch("/:id/delete", requireAuth, validateUuid("id"), patchUserDeleteHandler);

router.patch("/:id/restore", requireAuth, validateUuid("id"), patchUserRestoreHandler);
router.post("/sync", requireAuth, authSensitiveLimiter, validateBody(syncUserSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { clerkId, email } = req.body as z.infer<typeof syncUserSchema>;
    const canonicalClerkId = req.authUser!.clerkId;
    const canonicalEmail = req.authUser!.email;
    const canonicalName = req.authUser!.name;

    if (clerkId !== canonicalClerkId || email.toLowerCase() !== canonicalEmail.toLowerCase()) {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "SYNC_ID_MISMATCH",
          message: "Cannot sync a different user's data",
          requestId,
        }),
      );
    }

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.clerkId, canonicalClerkId), isNull(users.deletedAt)))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(users)
        .set({
          name: canonicalName || existing.name,
          email: canonicalEmail || existing.email,
        })
        .where(and(eq(users.clinicId, clinicId), eq(users.id, existing.id)))
        .returning();

      invalidateForUser(clinicId, existing.id);

      logAudit({
        actorRole: String(existing.role ?? "").trim().toLowerCase() || null,
        clinicId,
        actionType: "user_login",
        performedBy: existing.id,
        performedByEmail: canonicalEmail,
        targetId: existing.id,
        targetType: "user",
        metadata: { name: canonicalName, source: "authoritative_auth_context" },
      });

      return res.json(serializeUser(updated));
    }

    const insertedId = randomUUID();
    let newUser;
    let wasCreated = true;
    try {
      [newUser] = await db
        .insert(users)
        .values({
          id: insertedId,
          clinicId,
          clerkId: canonicalClerkId,
          email: canonicalEmail,
          name: canonicalName || "",
          displayName: canonicalName || canonicalEmail,
          role: "technician",
        })
        .onConflictDoUpdate({
          target: users.clerkId,
          set: {
            name: sql`
      CASE 
        WHEN EXCLUDED.name = '' THEN ${users.name} 
        ELSE EXCLUDED.name 
      END
    `,
            email: sql`
      CASE 
        WHEN EXCLUDED.email = '' THEN ${users.email} 
        ELSE EXCLUDED.email 
      END
    `,
            clinicId,
          },
        })
        .returning();
      wasCreated = newUser.id === insertedId;
      invalidateForUser(clinicId, newUser.id);
    } catch (insertErr: unknown) {
      const pgErr = insertErr as { code?: string };
      if (pgErr?.code === "23505") {
        console.warn("sync: duplicate clerkId race condition caught, fetching existing record", { clerkId: canonicalClerkId });
        const [race] = await db
          .select()
          .from(users)
          .where(and(eq(users.clinicId, clinicId), eq(users.clerkId, canonicalClerkId), isNull(users.deletedAt)))
          .limit(1);
        if (race) {
          return res.json({
            ...serializeUser(race),
          });
        }
      }
      throw insertErr;
    }

    if (wasCreated) {
      logAudit({
        actorRole: String(newUser.role ?? "technician").trim().toLowerCase() || null,
        clinicId,
        actionType: "user_provisioned",
        performedBy: newUser.id,
        performedByEmail: canonicalEmail,
        targetId: newUser.id,
        targetType: "user",
        metadata: { name: canonicalName, role: "technician", source: "authoritative_auth_context" },
      });
    } else {
      logAudit({
        actorRole: String(newUser.role ?? "").trim().toLowerCase() || null,
        clinicId,
        actionType: "user_login",
        performedBy: newUser.id,
        performedByEmail: canonicalEmail,
        targetId: newUser.id,
        targetType: "user",
        metadata: { name: canonicalName, recoveredFromRace: true, source: "authoritative_auth_context" },
      });
    }

    res.status(wasCreated ? 201 : 200).json(serializeUser(newUser));
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_SYNC_FAILED",
        message: "Failed to sync user",
        requestId,
      }),
    );
  }
});

/**
 * GET /api/users/purge-candidates
 * Returns count of soft-deleted users eligible for permanent purge.
 * Admin only — informational endpoint before committing to purge.
 */
router.get("/purge-candidates", requireAuth, requireAdmin, authSensitiveLimiter, getUsersPurgeCandidatesHandler);

/**
 * POST /api/users/purge-deleted
 * Permanently hard-deletes soft-deleted users that have been deleted for
 * longer than PURGE_AFTER_DAYS. Requires admin role. Logged to audit trail.
 * This is the ONLY way to permanently remove users — automatic cleanup
 * schedulers do not perform hard deletes.
 */
router.post("/purge-deleted", requireAuth, requireAdmin, authSensitiveLimiter, postUsersPurgeDeletedHandler);

// Returns eligible managers (vet/admin) for the Code Blue manager picker.
// All authenticated staff can see this list since they may need to designate a manager.
router.get("/managers", requireAuth, getUsersManagersHandler);

router.post("/backfill-clerk", requireAuth, requireAdmin, authSensitiveLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const actor = req.authUser!;
    const pageSize = 100;
    let offset = 0;

    let scanned = 0;
    let inserted = 0;
    let updated = 0;
    let skippedDemo = 0;
    let skippedIncomplete = 0;

    while (true) {
      const page = await clerkClient.organizations.getOrganizationMembershipList({
        organizationId: clinicId,
        limit: pageSize,
        offset,
      });
      const memberships = (page.data ?? []) as Array<{
        publicUserData?: {
          userId?: string;
          identifier?: string;
          firstName?: string;
          lastName?: string;
        };
      }>;

      if (memberships.length === 0) break;

      for (const membership of memberships) {
        scanned += 1;
        const clerkId = normalizeIdentityValue(membership.publicUserData?.userId);
        const email = normalizeIdentityValue(membership.publicUserData?.identifier).toLowerCase();
        const firstName = normalizeIdentityValue(membership.publicUserData?.firstName);
        const lastName = normalizeIdentityValue(membership.publicUserData?.lastName);
        const name = `${firstName} ${lastName}`.trim();
        const displayName = name || email;

        if (!clerkId || !email) {
          skippedIncomplete += 1;
          continue;
        }

        if (isDemoIdentity(clerkId, email, displayName)) {
          skippedDemo += 1;
          continue;
        }

        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.clerkId, clerkId), eq(users.clinicId, clinicId)))
          .limit(1);

        const [row] = await db
          .insert(users)
          .values({
            id: existing?.id ?? randomUUID(),
            clinicId,
            clerkId,
            email,
            name,
            displayName,
            role: "technician",
            status: "active",
          })
          .onConflictDoUpdate({
            target: users.clerkId,
            set: {
              clinicId,
              email,
              name: sql`CASE WHEN EXCLUDED.name = '' THEN ${users.name} ELSE EXCLUDED.name END`,
              displayName: sql`CASE WHEN EXCLUDED.display_name = '' THEN ${users.displayName} ELSE EXCLUDED.display_name END`,
              deletedAt: null,
              deletedBy: null,
            },
          })
          .returning({ id: users.id });

        if (existing?.id || row.id === existing?.id) {
          updated += 1;
        } else {
          inserted += 1;
        }
      }

      if (memberships.length < pageSize) break;
      offset += memberships.length;
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "users_backfilled_from_clerk",
      performedBy: actor.id,
      performedByEmail: actor.email,
      targetType: "user",
      metadata: { scanned, inserted, updated, skippedDemo, skippedIncomplete },
    });

    return res.json({
      ok: true,
      scanned,
      inserted,
      updated,
      skippedDemo,
      skippedIncomplete,
    });
  } catch (err) {
    console.error("users:backfill-clerk", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_BACKFILL_CLERK_FAILED",
        message: "Failed to backfill users from Clerk",
        requestId,
      }),
    );
  }
});

const appleLinkSchema = z.object({
  authorizationCode: z.string().trim().min(1, "authorizationCode is required").max(2000),
});

/**
 * POST /api/users/apple-link
 *
 * Captures the single-use Apple `authorizationCode` from a Sign in with Apple
 * sign-in, exchanges it at Apple's `/auth/token` for a refresh token, and
 * stores it (AES-256-GCM encrypted) so account deletion can later revoke the
 * user's tokens (App Store Guideline 5.1.1(v) + Apple's revocation requirement).
 *
 * Idempotent per user — re-linking replaces the stored token.
 */
router.post("/apple-link", requireAuth, authSensitiveLimiter, validateBody(appleLinkSchema), postUserAppleLinkHandler);

/**
 * DELETE /api/users/delete-account
 *
 * Self-service in-app account deletion (App Store Guideline 5.1.1(v)). Revokes
 * the user's Apple token at Apple, erases their personal data (hard delete when
 * referential integrity allows, otherwise an anonymized tombstone), and deletes
 * the Clerk user. The client signs out and redirects on success.
 *
 * Always operates on the CALLER's own account — never an arbitrary id.
 *
 * Uses requireAuthAny (not requireAuth) so a freshly-created status='pending'
 * account can still exercise its Guideline 5.1.1(v) right to self-delete — the
 * strict requireAuth gate would 403 (ACCOUNT_PENDING_APPROVAL) before this
 * handler runs. Self-scoped by construction (deleteOwnAccount reads req.authUser
 * only), and the demo/reviewer protected-account 403 stays enforced in the
 * service layer.
 */
router.delete("/delete-account", requireAuthAny, authSensitiveLimiter, deleteUserAccountHandler);

export default router;
