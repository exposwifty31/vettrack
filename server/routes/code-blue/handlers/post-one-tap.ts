import type { RequestHandler } from "express";
import type { z } from "zod";
import {
  orchestrateOneTapCodeBlue,
  DrizzleOneTapSessionTransaction,
  DrizzlePagingStateStore,
} from "../../../lib/code-blue-one-tap.js";
import { DrizzleStartClaimStore } from "../../../lib/code-blue-start-claim.js";
import {
  resolveNearestReadyCart,
  DrizzleInitiatingLocationSource,
  DrizzleReadyCartCandidateSource,
} from "../../../lib/code-blue-nearest-cart.js";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { enqueueNotificationJob } from "../../../lib/queue.js";
import { resolveCodeBlueBroadcastPushCopy } from "../../../lib/code-blue-broadcast-push.js";
import { postSystemMessage } from "../../../lib/shift-chat-presence.js";
import { invalidateActiveCodeBlueCache } from "../../../lib/code-blue-keepalive.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import { resolveNominatedManager } from "../resolve-nominated-manager.js";
import type { oneTapStartSchema } from "../schemas.js";

// POST /api/code-blue/one-tap — orchestrated "one tap, everything ready" start.
// Composes: durable idempotency claim → server-authoritative nearest-ready cart
// → CAS soft-reserve → session → outbox team page (+ status), all atomic. Same
// clinical gates as POST /sessions. Emergency mutation: online-only, offline-
// blocked via classifyEmergencyEndpoint, never optimistic.
export const postOneTapHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const body = req.body as z.infer<typeof oneTapStartSchema>;

    // Manager authority evaluator + validation — see resolveNominatedManager
    // for the full Phase 4 PR 4.2 + PR 4.5 evaluator wiring rationale.
    // Identical contract to POST /sessions.
    const managerUser = await resolveNominatedManager(res, requestId, clinicId, body.managerUserId);
    if (!managerUser) return;

    const locationSource = new DrizzleInitiatingLocationSource();
    const candidateSource = new DrizzleReadyCartCandidateSource();
    const outcome = await orchestrateOneTapCodeBlue(
      {
        claimStore: new DrizzleStartClaimStore(),
        resolveCart: (cId, uId, hint) =>
          resolveNearestReadyCart(cId, uId, { locationSource, candidateSource }, hint),
        sessionTx: new DrizzleOneTapSessionTransaction({
          startedByUserId: userId,
          startedByName: req.authUser!.name,
          managerUserId: managerUser.id,
          managerUserName: managerUser.name,
          preCheckPassed: body.preCheckPassed ?? null,
        }),
        pagingStateStore: new DrizzlePagingStateStore(),
      },
      {
        clinicId,
        token: body.idempotencyToken,
        initiatingUserId: userId,
        ...(body.locationHint ? { clientHint: body.locationHint } : {}),
      },
    );

    if (outcome.kind === "conflict") {
      // Retryable: an in-flight owner, a superseded fence, or an existing
      // active session. The client backs off and retries with the SAME token.
      return res.status(409).json(
        apiError({
          code: "CODE_BLUE_START_CONFLICT",
          reason: outcome.reason.toUpperCase(),
          message: "Another Code Blue start is in progress; retry with the same token",
          requestId,
        }),
      );
    }

    if (outcome.kind === "created") {
      postSystemMessage(clinicId, "code_blue_start", {
        startedBy: req.authUser!.name ?? userId,
        startedAt: new Date().toISOString(),
      }).catch((err) => {
        console.error("[code-blue] one-tap start system message failed (non-critical)", err);
      });

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "code_blue_started",
        performedBy: userId,
        performedByEmail: req.authUser!.email ?? "",
        targetId: outcome.sessionId,
        targetType: "code_blue_session",
        metadata: { via: "one_tap", managerUserId: managerUser.id },
      });

      const pushCopy = resolveCodeBlueBroadcastPushCopy(req.authUser!.name ?? "");
      void enqueueNotificationJob({
        type: "code_blue_broadcast",
        clinicId,
        title: pushCopy.title,
        body: pushCopy.body,
        tag: `code-blue-${outcome.sessionId}`,
        ...(outcome.pagingOutboxId !== null
          ? { notificationRequestOutboxId: outcome.pagingOutboxId }
          : {}),
      }).catch((err) => {
        console.error("[code-blue] one-tap broadcast notification failed (non-critical)", err);
      });

      invalidateActiveCodeBlueCache(clinicId);

      return res.status(201).json({
        outcome: "created",
        sessionId: outcome.sessionId,
        reservedCartId: outcome.reservedCartId,
        pagingState: outcome.pagingState,
      });
    }

    // Idempotent replay of the committed session — NO side effects; report the
    // CURRENT durable paging state (never a static success).
    return res.status(200).json({
      outcome: "replay",
      sessionId: outcome.sessionId,
      pagingState: outcome.pagingState,
    });
  } catch (err) {
    console.error("[code-blue] one-tap start failed", err);
    return res.status(500).json(
      apiError({
        code: "INTERNAL_ERROR",
        reason: "ONE_TAP_START_FAILED",
        message: "Failed to start Code Blue",
        requestId,
      }),
    );
  }
};
