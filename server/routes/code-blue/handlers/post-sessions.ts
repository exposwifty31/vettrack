import type { RequestHandler } from "express";
import type { z } from "zod";
import { randomUUID } from "crypto";
import { db, codeBlueSessions, codeBlueLogEntries, users, equipment } from "../../../db.js";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { logAudit, resolveAuditActorRole } from "../../../lib/audit.js";
import { insertRealtimeDomainEvent } from "../../../lib/realtime-outbox.js";
import { enqueueNotificationJob } from "../../../lib/queue.js";
import { resolveCodeBlueBroadcastPushCopy } from "../../../lib/code-blue-broadcast-push.js";
import { postSystemMessage } from "../../../lib/shift-chat-presence.js";
import { invalidateActiveCodeBlueCache } from "../../../lib/code-blue-keepalive.js";
import { evaluateCodeBlueManagerForRoute } from "../../../lib/authority/code-blue-manager.wiring.js";
import { resolveRequestId, apiError } from "../../../lib/route-utils.js";
import type { startSessionSchema } from "../schemas.js";

// POST /api/code-blue/sessions — start a new live session
export const postSessionsHandler: RequestHandler = async (req, res) => {
  const requestId = resolveRequestId(res, req.headers["x-request-id"]);
  try {
    const clinicId = req.clinicId!;
    const userId = req.authUser!.id;
    const body = req.body as z.infer<typeof startSessionSchema>;

    // Phase 4 PR 4.2 + PR 4.5 — Code Blue manager authority evaluator wiring.
    // Runs BEFORE existing manager validation + any side effects (DB insert,
    // push fan-out, system message, "started" audit). The evaluator emits
    // audit/metric internally based on the resolved mode.
    //
    // PR 4.5: in enforce mode the evaluator returns `action: "deny"`. The
    // route translates that into a 403 with a stable reason code in the
    // response body BEFORE any side effect commits. In shadow / off / mode-
    // inactive / fault-open paths the verdict is `action: "allow"` and the
    // route proceeds as before. Per-clinic vt_server_config
    // `code_blue.manager_enforce.<clinicId>.initiation = "enforce"` activates
    // the deny path; default (`off`) is unchanged.
    //
    // Evaluator targets the *named manager* via the existing resolver
    // framework. It MUST NOT read req.authoritySnapshot (which belongs to the
    // request actor, not the manager). The wiring helper loads vt_users by
    // id (clinic-scoped) and constructs a DB-only target user object.
    const { verdict: initiationVerdict } = await evaluateCodeBlueManagerForRoute({
      clinicId,
      managerUserId: body.managerUserId,
      endpoint: "initiation",
      now: new Date(),
    });
    if (initiationVerdict.action === "deny") {
      // Codex P2 (PR 4.5 review): the evaluator can deny with USER_MISSING
      // or MANAGER_CROSS_CLINIC, which are INPUT VALIDATION failures (the
      // nominated managerUserId points to a non-existent or cross-clinic
      // user), distinct from operational-role denials. Let those reasons
      // fall through to the existing INVALID_MANAGER 400 response so the
      // API contract for input validation is preserved. Only operational-
      // role denials (OPROLE_NOT_IN_CB_ALLOWLIST, NO_OPEN_CHECK_IN) return
      // the new 403 MANAGER_NOT_CODE_BLUE_ELIGIBLE response.
      const reason = initiationVerdict.reason;
      if (reason === "OPROLE_NOT_IN_CB_ALLOWLIST" || reason === "NO_OPEN_CHECK_IN") {
        return res.status(403).json(
          apiError({
            code: "MANAGER_NOT_CODE_BLUE_ELIGIBLE",
            reason,
            message:
              "Nominated manager is not currently Code-Blue-eligible (operational role check)",
            requestId,
          }),
        );
      }
      // USER_MISSING / MANAGER_CROSS_CLINIC: continue to the existing
      // managerUser DB lookup below, which returns 400 INVALID_MANAGER.
    }

    // Validate that managerUserId is an active vet or admin in this clinic
    const [managerUser] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.id, body.managerUserId),
          eq(users.clinicId, clinicId),
          inArray(users.role, ["vet", "admin"]),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    if (!managerUser) {
      return res.status(400).json(
        apiError({ code: "INVALID_MANAGER", reason: "INVALID_MANAGER", message: "Manager must be an active vet or admin in this clinic", requestId }),
      );
    }

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
    }).catch(() => {});

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

    const pushCopy = resolveCodeBlueBroadcastPushCopy(req.authUser!.name ?? "");
    void enqueueNotificationJob({
      type: "code_blue_broadcast",
      clinicId,
      title: pushCopy.title,
      body: pushCopy.body,
      tag: `code-blue-${id}`,
      ...(codeBlueNotificationRequestOutboxId !== undefined
        ? { notificationRequestOutboxId: codeBlueNotificationRequestOutboxId }
        : {}),
    }).catch(() => {
      /* non-critical */
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
