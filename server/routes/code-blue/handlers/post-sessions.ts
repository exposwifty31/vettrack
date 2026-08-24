import type { RequestHandler } from "express";
import type { z } from "zod";
import { randomUUID } from "crypto";
import { db, codeBlueSessions, codeBlueLogEntries, equipment } from "../../../db.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { insertRealtimeDomainEvent } from "../../../lib/realtime-outbox.js";
import { enqueueNotificationJob } from "../../../lib/queue.js";
import { postSystemMessage } from "../../../lib/shift-chat-presence.js";
import { invalidateActiveCodeBlueCache } from "../../../lib/code-blue-keepalive.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import { getLocaleDictionaries } from "../../../../lib/i18n/loader.js";
import { interpolate, translate } from "../../../../lib/i18n/index.js";
import { resolveNominatedManager } from "../resolve-nominated-manager.js";
import type { startSessionSchema } from "../schemas.js";

// POST /api/code-blue/sessions — start a new live session
export const postSessionsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const body = req.body as z.infer<typeof startSessionSchema>;

    // Manager authority evaluator + validation — see resolveNominatedManager
    // for the full Phase 4 PR 4.2 + PR 4.5 evaluator wiring rationale.
    // Identical contract to POST /one-tap.
    const managerUser = await resolveNominatedManager(res, requestId, clinicId, body.managerUserId);
    if (!managerUser) return;

    let primaryEquipment: { id: string; name: string } | null = null;
    if (body.equipmentId) {
      const [eqRow] = await db
        .select({ id: equipment.id, name: equipment.name })
        .from(equipment)
        .where(
          and(
            eq(equipment.id, body.equipmentId),
            eq(equipment.clinicId, clinicId),
            isNull(equipment.deletedAt),
          ),
        )
        .limit(1);
      if (!eqRow) {
        return res.status(400).json(
          apiError({
            code: "INVALID_EQUIPMENT",
            reason: "INVALID_EQUIPMENT",
            message: "Equipment not found in this clinic",
            requestId,
          }),
        );
      }
      primaryEquipment = eqRow;
    }

    const id = randomUUID();
    const startedAt = new Date();

    let codeBlueNotificationRequestOutboxId: number | undefined;
    let activeSessionExists = false;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`code-blue-active-session:${clinicId}`}, 0))
      `);

      // P1-4: serialize the guard with the insert so concurrent starts cannot
      // both observe "no active session" before either writes.
      const [existingActive] = await tx
        .select({ id: codeBlueSessions.id })
        .from(codeBlueSessions)
        .where(
          and(
            eq(codeBlueSessions.clinicId, clinicId),
            eq(codeBlueSessions.status, "active"),
          ),
        )
        .limit(1);
      if (existingActive) {
        activeSessionExists = true;
        return;
      }

      await tx.insert(codeBlueSessions).values({
        id,
        clinicId,
        startedAt,
        startedBy: userId,
        startedByName: req.authUser!.name,
        managerUserId: managerUser.id,
        managerUserName: managerUser.name,
        preCheckPassed: body.preCheckPassed ?? null,
        status: "active",
      });

      if (primaryEquipment) {
        await tx.insert(codeBlueLogEntries).values({
          id: randomUUID(),
          sessionId: id,
          clinicId,
          idempotencyKey: randomUUID(),
          elapsedMs: 0,
          label: primaryEquipment.name,
          category: "equipment",
          equipmentId: primaryEquipment.id,
          loggedByUserId: userId,
          loggedByName: req.authUser!.name,
        });
      }

      codeBlueNotificationRequestOutboxId = await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "NOTIFICATION_REQUESTED",
        payload: {
          channel: "code_blue_role_broadcast",
          sessionId: id,
          tag: `code-blue-${id}`,
        },
        occurredAt: startedAt,
      });
      await insertRealtimeDomainEvent(tx, {
        clinicId,
        type: "CODE_BLUE_STATUS_CHANGED",
        payload: { sessionId: id, status: "active" },
        occurredAt: startedAt,
      });
    });

    if (activeSessionExists) {
      return res.status(409).json(
        apiError({
          code: "ACTIVE_SESSION_EXISTS",
          reason: "ACTIVE_SESSION_EXISTS",
          message: "An active Code Blue session already exists for this clinic",
          requestId,
        }),
      );
    }

    postSystemMessage(clinicId, "code_blue_start", {
      startedBy: req.authUser!.name ?? req.authUser!.id,
      startedAt: startedAt.toISOString(),
    }).catch((err) => {
      console.error("[code-blue] start system message failed (non-critical)", err);
    });

    logAudit({
      actorRole: resolveAuditActorRole(req),
      clinicId,
      actionType: "code_blue_started",
      performedBy: userId,
      performedByEmail: req.authUser!.email ?? "",
      targetId: id,
      targetType: "code_blue_session",
      metadata: { startedAt: startedAt.toISOString(), managerUserId: body.managerUserId },
    });

    const { primary: broadcastPrimary, fallback: broadcastFallback, locale: broadcastLc } = getLocaleDictionaries("he");
    const broadcastBodyTemplate = translate(broadcastPrimary, "codeBlue.pushBroadcastBody", undefined, { fallbackDict: broadcastFallback, locale: broadcastLc });
    void enqueueNotificationJob({
      type: "code_blue_broadcast",
      clinicId,
      title: "⚠ CODE BLUE",
      body: interpolate(broadcastBodyTemplate, { name: req.authUser!.name }),
      tag: `code-blue-${id}`,
      ...(codeBlueNotificationRequestOutboxId !== undefined
        ? { notificationRequestOutboxId: codeBlueNotificationRequestOutboxId }
        : {}),
    }).catch((err) => {
      console.error("[code-blue] start broadcast notification failed (non-critical)", err);
    });

    // Phase 9 PR 9.4 — invalidate the keepalive's active-session cache so
    // the next SSE KEEPALIVE event reflects this start within ≤ 5 s.
    invalidateActiveCodeBlueCache(clinicId);

    res.status(201).json({ id, startedAt: startedAt.toISOString() });
  } catch (err) {
    console.error("[code-blue] start session failed", err);
    res.status(500).json(
      apiError({ code: "INTERNAL_ERROR", reason: "SESSION_START_FAILED", message: "Failed to start session", requestId }),
    );
  }
};
