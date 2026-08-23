import type { RequestHandler } from "express";
import { db, users } from "../../../db.js";
import { eq, and } from "drizzle-orm";
import { resolveCurrentRole } from "../../../lib/role-resolution.js";
import { resolveAuthority } from "../../../lib/authority.js";
import { canManageErModeForUser } from "../../../lib/er-mode-permissions.js";
import { presignObjectUrl } from "../../../lib/object-storage.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

/** GET /api/users/me */
export const getUsersMeHandler: RequestHandler = async (req, res) => {
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
      .select({
        avatarUrl: users.avatarUrl,
        preferredLocale: users.preferredLocale,
        seniorDoctorEligible: users.seniorDoctorEligible,
      })
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
      preferredLocale: profileRow?.preferredLocale ?? "he",
      seniorDoctorEligible: profileRow?.seniorDoctorEligible ?? false,
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
};
