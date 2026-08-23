import type { RequestHandler } from "express";
import { randomUUID } from "crypto";
import { db, appleOauthTokens } from "../../../db.js";
import { encryptConfigValue } from "../../../lib/config-crypto.js";
import {
  AppleAuthError,
  exchangeAppleAuthorizationCode,
  isAppleRevocationConfigured,
} from "../../../lib/apple-auth.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { resolveRequestId, apiError } from "../users-route-utils.js";

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
export const postUserAppleLinkHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const actor = req.authUser!;
    const { authorizationCode } = req.body as { authorizationCode: string };

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
};
