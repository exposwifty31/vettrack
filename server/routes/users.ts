// TODO(arch): file exceeds 1100 lines. Split into handler modules following
// the equipment-route-utils.ts / handlers/ pattern already started in this directory.
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, users, appleOauthTokens, shiftSessions } from "../db.js";
import { eq, sql, isNull, isNotNull, desc, and } from "drizzle-orm";
import { requireAuth, requireAuthAny, requireAdmin } from "../middleware/auth.js";
import { clerkClient } from "@clerk/express";
import { validateBody, validateUuid } from "../middleware/validate.js";
import { authSensitiveLimiter } from "../middleware/rate-limiters.js";
import { encryptConfigValue } from "../lib/config-crypto.js";
import {
  AppleAuthError,
  exchangeAppleAuthorizationCode,
  isAppleRevocationConfigured,
} from "../lib/apple-auth.js";
import { deleteOwnAccount, AccountDeletionProtectedError } from "../services/account-deletion.service.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { resolveApprovalRole } from "../lib/approval-role.js";
import { resolveCurrentRole } from "../lib/role-resolution.js";
import { resolveAuthority } from "../lib/authority.js";
import { invalidateForUser } from "../lib/authority-cache.js";
import { ensureUserEmail } from "../services/user-sync.service.js";
import { countPurgeCandidates, purgeDeletedUsers, PURGE_AFTER_DAYS } from "../lib/cleanup-scheduler.js";
import { canManageErModeForUser } from "../lib/er-mode-permissions.js";
import { resolveRequestId, apiError } from "../lib/route-utils.js";
import { presignObjectUrl } from "../lib/object-storage.js";

/*
 * PERMISSIONS MATRIX — /api/users
 * ─────────────────────────────────────────────────────
 * GET   /me          student+    Current authenticated user's profile
 * GET   /            admin-only  List all users
 * PATCH /:id/role    admin-only  Change a user's role
 * POST  /sync        student+    Sync Clerk identity to DB record
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

/** Admin list only: includes clerkId for self-healing missing emails from Clerk. */
const adminListUserFields = {
  ...userFields,
  clerkId: users.clerkId,
  secondaryRole: users.secondaryRole,
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

router.get("/me", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!req.authUser) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    const now = new Date();
    const resolved = await resolveCurrentRole({
      clinicId: req.clinicId!,
      userId: req.authUser.id,
      userName: req.authUser.name,
      fallbackRole: req.authUser.role,
      now,
    });

    const [profileRow] = await db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(and(eq(users.clinicId, req.clinicId!), eq(users.id, req.authUser.id)))
      .limit(1);

    // avatarUrl is stored as a private-bucket object key; presign for the client.
    const avatarUrl = await presignObjectUrl(profileRow?.avatarUrl);

    // Legacy effectiveRole remains authoritative in Phase 2A.
    // Authority snapshot is advisory only.
    // See docs/authority-model.md §1-§2.
    let authority: Awaited<ReturnType<typeof resolveAuthority>> | undefined;
    try {
      authority = await resolveAuthority({
        authUser: req.authUser,
        clinicId: req.clinicId!,
        now,
      });
    } catch (authorityErr) {
      console.error("[users:me] resolveAuthority failed", authorityErr);
    }

    res.json({
      ...req.authUser,
      avatarUrl,
      effectiveRole: resolved.effectiveRole,
      roleSource: resolved.source,
      activeShift: resolved.activeShift,
      resolvedAt: resolved.resolvedAt.toISOString(),
      canManageErMode: canManageErModeForUser(req.authUser),
      ...(authority ? { authority } : {}),
    });
  } catch (err) {
    console.error("[users:me] resolveCurrentRole failed", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_ME_FAILED",
        message: "Failed to get user",
        requestId,
      }),
    );
  }
});

router.get("/me/shift-activity", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const sessions = await db
      .select({
        id: shiftSessions.id,
        startedAt: shiftSessions.startedAt,
        endedAt: shiftSessions.endedAt,
        note: shiftSessions.note,
      })
      .from(shiftSessions)
      .where(and(
        eq(shiftSessions.clinicId, clinicId),
        eq(shiftSessions.startedByUserId, userId),
      ))
      .orderBy(desc(shiftSessions.startedAt))
      .limit(20);
    res.json(sessions);
  } catch (err) {
    console.error("[users:me:shift-activity] failed", err);
    res.status(500).json(apiError({
      code: "INTERNAL_ERROR",
      reason: "SHIFT_ACTIVITY_FETCH_FAILED",
      message: "Failed to get shift activity",
      requestId,
    }));
  }
});

router.get("/deleted", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const deletedUsers = await db
      .select({ ...userFields, deletedAt: users.deletedAt })
      .from(users)
      .where(and(eq(users.clinicId, clinicId), isNotNull(users.deletedAt)))
      .orderBy(desc(users.deletedAt));
    res.json(deletedUsers);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_LIST_DELETED_FAILED",
        message: "Failed to list deleted users",
        requestId,
      }),
    );
  }
});

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status } = req.query;
    const validStatuses = ["pending", "active", "blocked"];
    if (status !== undefined && !validStatuses.includes(status as string)) {
      return res.status(400).json(
        apiError({
          code: "VALIDATION_FAILED",
          reason: "INVALID_STATUS_FILTER",
          message: "Invalid status filter. Must be one of: pending, active, blocked",
          requestId,
        }),
      );
    }

    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawPage = parseInt(req.query.page as string, 10);
    const resolvedLimit = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 200) : 100;
    const page = (!isNaN(rawPage) && rawPage > 1) ? rawPage : 1;
    const resolvedOffset = (page - 1) * resolvedLimit;

    const baseQuery = status
      ? db
          .select(adminListUserFields)
          .from(users)
          .where(and(eq(users.clinicId, clinicId), eq(users.status, status as string), isNull(users.deletedAt)))
          .orderBy(desc(users.createdAt))
      : db
          .select(adminListUserFields)
          .from(users)
          .where(and(eq(users.clinicId, clinicId), isNull(users.deletedAt)))
          .orderBy(desc(users.createdAt));

    const whereClause = status
      ? and(eq(users.clinicId, clinicId), eq(users.status, status as string), isNull(users.deletedAt))
      : and(eq(users.clinicId, clinicId), isNull(users.deletedAt));
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(whereClause);
    const items = await baseQuery.limit(resolvedLimit).offset(resolvedOffset);
    const healedRows = await Promise.all(items.map((u) => ensureUserEmail(u)));
    const healedItems = items.map((item, i) => ({
      id: item.id,
      email: healedRows[i].email,
      name: item.name,
      displayName: item.displayName,
      role: item.role,
      secondaryRole: item.secondaryRole ?? null,
      status: item.status,
      createdAt: item.createdAt,
    }));
    res.json({
      items: healedItems,
      total,
      page,
      pageSize: resolvedLimit,
      hasMore: resolvedOffset + healedItems.length < total,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_LIST_FAILED",
        message: "Failed to list users",
        requestId,
      }),
    );
  }
});

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

router.patch("/:id/role", requireAuth, requireAdmin, validateUuid("id"), validateBody(patchRoleSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { role } = req.body as z.infer<typeof patchRoleSchema>;

    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!target) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    if (target.role === "admin" && role !== "admin") {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.clinicId, clinicId), eq(users.role, "admin"), isNull(users.deletedAt)));
      if (count <= 1) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "LAST_ADMIN_DEMOTION_BLOCKED",
            message: "Cannot demote the last admin. Promote another user to admin first.",
            requestId,
          }),
        );
      }
    }

    const [user] = await db
      .update(users)
      .set({ role })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .returning();

    invalidateForUser(clinicId, req.params.id);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_role_changed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { previousRole: target.role, newRole: role, targetEmail: target.email },
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_ROLE_UPDATE_FAILED",
        message: "Failed to update role",
        requestId,
      }),
    );
  }
});

const patchSecondaryRoleSchema = z.object({
  secondaryRole: z.enum(["technician", "senior_technician", "admin"]).nullable(),
});

router.patch("/:id/secondary-role", requireAuth, requireAdmin, validateUuid("id"), validateBody(patchSecondaryRoleSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { secondaryRole } = req.body as z.infer<typeof patchSecondaryRoleSchema>;

    await db
      .update(users)
      .set({ secondaryRole })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)));

    const [updated] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!updated) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_secondary_role_changed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { newSecondaryRole: secondaryRole, targetEmail: updated.email },
    });

    return res.json({ user: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_SECONDARY_ROLE_UPDATE_FAILED",
        message: "Failed to update secondary role",
        requestId,
      }),
    );
  }
});

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
  async (req, res) => {
    const requestId = resolveRequestId(res, req.headers["x-request-id"]);
    try {
      const clinicId = req.clinicId!;
      const { isEquipmentCoordinator } = req.body as z.infer<typeof patchEquipmentCoordinatorSchema>;

      const [updated] = await db
        .update(users)
        .set({ isEquipmentCoordinator })
        .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
        .returning();

      if (!updated) {
        return res.status(404).json(
          apiError({
            code: "NOT_FOUND",
            reason: "USER_NOT_FOUND",
            message: "User not found",
            requestId,
          }),
        );
      }

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "equipment_coordinator_eligibility_set",
        performedBy: req.authUser!.id,
        performedByEmail: req.authUser!.email,
        targetId: req.params.id,
        targetType: "user",
        metadata: { isEquipmentCoordinator, targetEmail: updated.email },
      });

      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json(
        apiError({
          code: "INTERNAL_ERROR",
          reason: "EQUIPMENT_COORDINATOR_UPDATE_FAILED",
          message: "Failed to update equipment coordinator eligibility",
          requestId,
        }),
      );
    }
  },
);

router.patch("/:id/status", requireAuth, requireAdmin, validateUuid("id"), validateBody(patchStatusSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const { status, role: overrideRole } = req.body as z.infer<typeof patchStatusSchema>;

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    // C3: on approval (pending → active), promote to the self-requested role so
    // the admin doesn't re-select it. Vet is gated on a doctor/license number.
    const approval = resolveApprovalRole({
      currentStatus: existing.status,
      newStatus: status,
      requestedRole: existing.requestedRole,
      overrideRole: overrideRole ?? null,
      vetLicenseNumber: existing.vetLicenseNumber,
    });
    if (!approval.ok) {
      return res.status(422).json(
        apiError({
          code: "VET_LICENSE_REQUIRED",
          reason: "VET_LICENSE_REQUIRED",
          message: "A doctor/license number is required to approve a veterinarian",
          requestId,
        }),
      );
    }

    // Guard the update on the status we reviewed: two admins can both observe
    // `pending`, and without this predicate the second write would clobber the
    // first (overwriting a block, or re-granting a role). A null result on a
    // row we already fetched means the status changed concurrently → 409.
    const [user] = await db
      .update(users)
      .set(approval.roleToApply ? { status, role: approval.roleToApply } : { status })
      .where(
        and(
          eq(users.clinicId, clinicId),
          eq(users.id, req.params.id),
          eq(users.status, existing.status),
          isNull(users.deletedAt),
        ),
      )
      .returning();

    if (!user) {
      return res.status(409).json(
        apiError({
          code: "CONFLICT",
          reason: "USER_STATUS_CONFLICT",
          message: "User status changed concurrently; reload and retry",
          requestId,
        }),
      );
    }

    // A granted role changes clinical capabilities — drop the authority cache so
    // the new role takes effect immediately (mirrors PATCH /:id/role).
    if (approval.roleToApply) {
      invalidateForUser(clinicId, user.id);
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_status_changed",
      performedBy: req.authUser!.id,
      performedByEmail: req.authUser!.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: {
        previousStatus: existing.status,
        newStatus: status,
        targetEmail: user.email,
        ...(approval.roleToApply ? { grantedRole: approval.roleToApply } : {}),
      },
    });

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_STATUS_UPDATE_FAILED",
        message: "Failed to update status",
        requestId,
      }),
    );
  }
});

router.patch("/:id/display_name", requireAuthAny, validateUuid("id"), validateBody(patchDisplayNameSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!req.authUser) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    const clinicId = req.clinicId!;

    const { display_name } = req.body as z.infer<typeof patchDisplayNameSchema>;
    const actorId = req.authUser.id;

    if (actorId !== req.params.id && req.authUser.role !== "admin") {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "INSUFFICIENT_ROLE",
          message: "Forbidden",
          requestId,
        }),
      );
    }

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    const [updated] = await db
      .update(users)
      .set({ displayName: display_name })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id)))
      .returning();

    invalidateForUser(clinicId, req.params.id);

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_display_name_changed",
      performedBy: actorId,
      performedByEmail: req.authUser.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: {
        field: "display_name",
        previousDisplayName: existing.displayName,
        newDisplayName: updated.displayName,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_DISPLAY_NAME_UPDATE_FAILED",
        message: "Failed to update display name",
        requestId,
      }),
    );
  }
});

router.patch("/:id/delete", requireAuth, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!req.authUser) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    const clinicId = req.clinicId!;

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    const actorId = req.authUser.id;
    const isSelf = actorId === req.params.id;
    const isAdmin = req.authUser.role === "admin";
    if (!isSelf && !isAdmin) {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "INSUFFICIENT_ROLE",
          message: "Forbidden",
          requestId,
        }),
      );
    }

    if (existing.role === "admin" && isAdmin && !isSelf) {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.clinicId, clinicId), eq(users.role, "admin"), isNull(users.deletedAt)));
      if (count <= 1) {
        return res.status(409).json(
          apiError({
            code: "CONFLICT",
            reason: "LAST_ADMIN_DELETE_BLOCKED",
            message: "Cannot delete the last admin. Promote another user to admin first.",
            requestId,
          }),
        );
      }
    }

    const [deleted] = await db
      .update(users)
      .set({ deletedAt: new Date(), deletedBy: actorId })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNull(users.deletedAt)))
      .returning();

    if (!deleted) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND",
          message: "User not found",
          requestId,
        }),
      );
    }

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_deleted",
      performedBy: actorId,
      performedByEmail: req.authUser.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { email: deleted.email, role: deleted.role },
    });

    res.json(deleted);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_DELETE_FAILED",
        message: "Failed to delete user",
        requestId,
      }),
    );
  }
});

router.patch("/:id/restore", requireAuth, validateUuid("id"), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    if (!req.authUser) {
      return res.status(401).json(
        apiError({
          code: "UNAUTHORIZED",
          reason: "MISSING_AUTH_USER",
          message: "Unauthorized",
          requestId,
        }),
      );
    }
    const clinicId = req.clinicId!;

    const actorId = req.authUser.id;
    const isSelf = actorId === req.params.id;
    const isAdmin = req.authUser.role === "admin";
    if (!isSelf && !isAdmin) {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "INSUFFICIENT_ROLE",
          message: "Forbidden",
          requestId,
        }),
      );
    }

    const [existing] = await db
      .select()
      .from(users)
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), isNotNull(users.deletedAt)))
      .limit(1);

    if (!existing) {
      return res.status(404).json(
        apiError({
          code: "NOT_FOUND",
          reason: "USER_NOT_FOUND_OR_NOT_DELETED",
          message: "User not found or not deleted",
          requestId,
        }),
      );
    }

    const [restored] = await db
      .update(users)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(eq(users.clinicId, clinicId), eq(users.id, req.params.id)))
      .returning();

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "user_restored",
      performedBy: actorId,
      performedByEmail: req.authUser.email,
      targetId: req.params.id,
      targetType: "user",
      metadata: { email: restored.email, role: restored.role },
    });

    res.json(restored);
  } catch (err) {
    console.error(err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USER_RESTORE_FAILED",
        message: "Failed to restore user",
        requestId,
      }),
    );
  }
});
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
router.get("/purge-candidates", requireAuth, requireAdmin, authSensitiveLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const count = await countPurgeCandidates();
    res.json({ count, purgeAfterDays: PURGE_AFTER_DAYS });
  } catch (err) {
    console.error("users:purge-candidates", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PURGE_CANDIDATES_FAILED",
        message: "Failed to count purge candidates",
        requestId,
      }),
    );
  }
});

/**
 * POST /api/users/purge-deleted
 * Permanently hard-deletes soft-deleted users that have been deleted for
 * longer than PURGE_AFTER_DAYS. Requires admin role. Logged to audit trail.
 * This is the ONLY way to permanently remove users — automatic cleanup
 * schedulers do not perform hard deletes.
 */
router.post("/purge-deleted", requireAuth, requireAdmin, authSensitiveLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const actor = req.authUser!;
    const { purged } = await purgeDeletedUsers({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      clinicId,
    });
    return res.json({ ok: true, purged, purgeAfterDays: PURGE_AFTER_DAYS });
  } catch (err) {
    console.error("users:purge-deleted", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "PURGE_DELETED_FAILED",
        message: "Failed to purge deleted users",
        requestId,
      }),
    );
  }
});

// Returns eligible managers (vet/admin) for the Code Blue manager picker.
// All authenticated staff can see this list since they may need to designate a manager.
router.get("/managers", requireAuth, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const managers = await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.clinicId, clinicId),
          eq(users.status, "active"),
          isNull(users.deletedAt),
          sql`${users.role} IN ('vet', 'admin')`,
        ),
      )
      .orderBy(users.name);
    res.json({ managers });
  } catch (err) {
    console.error("users:managers", err);
    res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "USERS_MANAGERS_FAILED",
        message: "Failed to list eligible managers",
        requestId,
      }),
    );
  }
});

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
router.post("/apple-link", requireAuth, authSensitiveLimiter, validateBody(appleLinkSchema), async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const actor = req.authUser!;
    const { authorizationCode } = req.body as z.infer<typeof appleLinkSchema>;

    if (!isAppleRevocationConfigured()) {
      return res.status(501).json(
        apiError({
          code: "NOT_CONFIGURED",
          reason: "APPLE_REVOCATION_NOT_CONFIGURED",
          message: "Apple token revocation is not configured on this server",
          requestId,
        }),
      );
    }

    const { refreshToken, appleSub } = await exchangeAppleAuthorizationCode(authorizationCode);
    const encrypted = encryptConfigValue(refreshToken);

    await db
      .insert(appleOauthTokens)
      .values({
        id: randomUUID(),
        clinicId,
        userId: actor.id,
        refreshToken: encrypted,
        appleSub,
      })
      .onConflictDoUpdate({
        target: appleOauthTokens.userId,
        set: { refreshToken: encrypted, appleSub, updatedAt: new Date() },
      });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "apple_token_linked",
      performedBy: actor.id,
      performedByEmail: actor.email,
      targetId: actor.id,
      targetType: "user",
      metadata: { source: "apple_authorization_code_exchange" },
    });

    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof AppleAuthError) {
      return res.status(err.status === 501 ? 501 : 502).json(
        apiError({
          code: err.status === 501 ? "NOT_CONFIGURED" : "BAD_GATEWAY",
          reason: "APPLE_TOKEN_EXCHANGE_FAILED",
          message: "Could not link your Apple account. Please try again.",
          requestId,
        }),
      );
    }
    console.error("users:apple-link", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "APPLE_LINK_FAILED",
        message: "Failed to link Apple account",
        requestId,
      }),
    );
  }
});

/**
 * DELETE /api/users/delete-account
 *
 * Self-service in-app account deletion (App Store Guideline 5.1.1(v)). Revokes
 * the user's Apple token at Apple, erases their personal data (hard delete when
 * referential integrity allows, otherwise an anonymized tombstone), and deletes
 * the Clerk user. The client signs out and redirects on success.
 *
 * Always operates on the CALLER's own account — never an arbitrary id.
 */
router.delete("/delete-account", requireAuth, authSensitiveLimiter, async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const actor = req.authUser!;
    invalidateForUser(actor.clinicId, actor.id);
    const result = await deleteOwnAccount(actor);

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof AccountDeletionProtectedError) {
      return res.status(403).json(
        apiError({
          code: "FORBIDDEN",
          reason: "ACCOUNT_DELETION_PROTECTED",
          message: "This account cannot be deleted through the app.",
          requestId,
        }),
      );
    }
    console.error("users:delete-account", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ACCOUNT_DELETION_FAILED",
        message: "Deletion failed. Please try again.",
        requestId,
      }),
    );
  }
});

export default router;
