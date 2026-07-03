import { Router, type Request } from "express";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  db, shiftMessages, shiftMessageAcks, shiftMessageReactions, shiftSessions, shifts,
} from "../db.js";
import {
  getCurrentShiftWindow, windowMessagesWhere, type ChatWindow,
} from "../lib/shift-chat-window.js";
import { combineLocal, parseWindowSessionId, windowBounds } from "../lib/shift-window.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limiters.js";
import { validateBody } from "../middleware/validate.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";
import { enqueueNotificationJob, enqueuePushNotification } from "../lib/queue.js";
import { insertRealtimeDomainEvent } from "../lib/realtime-outbox.js";
import { touchPresence, getPresence } from "../lib/shift-chat-presence.js";
import { logAudit, resolveAuditActorRole } from "../lib/audit.js";
import { resolveRequestId } from "../lib/route-utils.js";

const router = Router();

function apiError(params: { code: string; reason?: string; message: string; requestId?: string }) {
  const requestId = params.requestId ?? randomUUID();
  return {
    code: params.code,
    error: params.code,
    reason: params.reason ?? params.code,
    message: params.message,
    requestId,
  };
}

/**
 * Roster-derived chat window for the calling user (see lib/shift-chat-window.ts).
 * Never consults the orphaned vt_shift_sessions clock-in table — a stale
 * never-ended row there is what kept weeks-old transcripts alive (BUG-001).
 */
function getRequestShiftWindow(req: Request): Promise<ChatWindow | null> {
  const user = req.authUser!;
  return getCurrentShiftWindow({
    clinicId: req.clinicId!,
    userId: user.id,
    userName: user.name ?? "",
    fallbackRole: user.role,
    secondaryRole: user.secondaryRole ?? null,
  });
}

// ─── GET /api/shift-chat/messages ────────────────────────────────────────────

router.get(
  "/messages",
  requireAuth,
  requireEffectiveRole("technician"),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const userId   = req.authUser!.id;
    const userName = req.authUser!.name ?? "Unknown";
    const after    = req.query.after as string | undefined;

    // Update presence (marks user as online)
    touchPresence(clinicId, userId, userName);

    try {
      const shiftWindow = await getRequestShiftWindow(req);
      if (!shiftWindow) {
        return res.json({ messages: [], pinnedMessage: null, typing: [], onlineUserIds: [], shiftSessionId: null });
      }

      const afterDate = after ? new Date(after) : undefined;
      if (afterDate && Number.isNaN(afterDate.getTime())) {
        return res.status(400).json(apiError({ code: "VALIDATION_FAILED", reason: "INVALID_AFTER", message: "Invalid after timestamp" }));
      }

      const rows = await db
        .select()
        .from(shiftMessages)
        .where(windowMessagesWhere(clinicId, shiftWindow, afterDate))
        .orderBy(asc(shiftMessages.createdAt));

      // Fetch acks for broadcast messages in this batch
      const broadcastIds = rows
        .filter((m) => m.type === "broadcast")
        .map((m) => m.id);

      const acksMap = new Map<string, { userId: string; status: string }[]>();
      if (broadcastIds.length > 0) {
        const acks = await db
          .select()
          .from(shiftMessageAcks)
          .where(inArray(shiftMessageAcks.messageId, broadcastIds));
        for (const ack of acks) {
          const list = acksMap.get(ack.messageId) ?? [];
          list.push({ userId: ack.userId, status: ack.status });
          acksMap.set(ack.messageId, list);
        }
      }

      // Fetch reactions for all messages in this batch
      const messageIds = rows.map((m) => m.id);
      const reactionsMap = new Map<string, { userId: string; emoji: string }[]>();
      if (messageIds.length > 0) {
        const reactions = await db
          .select()
          .from(shiftMessageReactions)
          .where(inArray(shiftMessageReactions.messageId, messageIds));
        for (const r of reactions) {
          const list = reactionsMap.get(r.messageId) ?? [];
          list.push({ userId: r.userId, emoji: r.emoji });
          reactionsMap.set(r.messageId, list);
        }
      }

      // Query pinned message independently of afterDate filter so it persists across incremental polls
      const [pinnedRow] = await db
        .select()
        .from(shiftMessages)
        .where(
          and(
            windowMessagesWhere(clinicId, shiftWindow),
            isNotNull(shiftMessages.pinnedAt),
          ),
        )
        .orderBy(desc(shiftMessages.pinnedAt))
        .limit(1);

      // Rows are normalized to the viewer's window id: stored stamps vary by
      // poster window, and the client drops rows whose shiftSessionId differs
      // from the reported session (message-scoping.ts).
      const messages = rows.map((m) => ({
        ...m,
        shiftSessionId: shiftWindow.id,
        acks: acksMap.get(m.id) ?? [],
        reactions: reactionsMap.get(m.id) ?? [],
      }));

      const presence = getPresence(clinicId);

      return res.json({
        messages,
        pinnedMessage: pinnedRow
          ? { ...pinnedRow, shiftSessionId: shiftWindow.id, acks: acksMap.get(pinnedRow.id) ?? [], reactions: reactionsMap.get(pinnedRow.id) ?? [] }
          : null,
        typing: presence.typing,
        onlineUserIds: presence.onlineUserIds,
        shiftSessionId: shiftWindow.id,
      });
    } catch (err) {
      console.error("[shift-chat] GET /messages error:", err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", message: "Internal server error" }));
    }
  },
);

// ─── POST /api/shift-chat/messages ───────────────────────────────────────────

export const BROADCAST_TEMPLATES: Record<string, { label: string; subtitle: string }> = {
  department_close: { label: "סגירת מחלקה", subtitle: "כל הטכנאים — לנקות ולסדר את המחלקה" },
};

const postMessageSchema = z.object({
  body: z.string().max(1000),
  type: z.enum(["regular", "broadcast"]),
  broadcastKey: z.string().optional(),
  roomTag: z.string().max(50).optional(),
  isUrgent: z.boolean().optional().default(false),
  mentionedUserIds: z.array(z.string()).optional().default([]),
});

router.post(
  "/messages",
  requireAuth,
  requireEffectiveRole("technician"),
  writeLimiter,
  validateBody(postMessageSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const user = req.authUser!;
    const { body, type, broadcastKey, roomTag, isUrgent, mentionedUserIds } =
      req.body as z.infer<typeof postMessageSchema>;

    // Broadcast requires senior_technician or admin
    if (type === "broadcast") {
      const role = req.effectiveRole ?? user.role;
      if (role !== "senior_technician" && role !== "admin") {
        return res.status(403).json(apiError({ code: "FORBIDDEN", reason: "BROADCAST_FORBIDDEN", message: "Only senior technicians can send broadcasts" }));
      }
      if (!broadcastKey || !BROADCAST_TEMPLATES[broadcastKey]) {
        return res.status(400).json(apiError({ code: "BAD_REQUEST", reason: "INVALID_BROADCAST_KEY", message: "Unknown broadcast key" }));
      }
    }

    try {
      const shiftWindow = await getRequestShiftWindow(req);
      if (!shiftWindow) {
        return res.status(409).json(apiError({ code: "CONFLICT", reason: "NO_OPEN_SHIFT", message: "No active shift for this clinic" }));
      }

      const [message] = await db
        .insert(shiftMessages)
        .values({
          id: randomUUID(),
          shiftSessionId: shiftWindow.id,
          clinicId,
          senderId: user.id,
          senderName: user.name ?? null,
          senderRole: req.effectiveRole ?? user.role,
          body,
          type,
          broadcastKey: broadcastKey ?? null,
          systemEventType: null,
          systemEventPayload: null,
          roomTag: roomTag ?? null,
          isUrgent,
          mentionedUserIds,
          pinnedAt: null,
          pinnedByUserId: null,
        })
        .returning();

      // ── Push notifications (Fix F/G: all routed through queue with fallback) ─

      // @mentions → HIGH priority push to each mentioned user
      for (const mentionedUserId of mentionedUserIds) {
        const idempotencyKey = `shift-chat-mention-${message!.id}-${mentionedUserId}`;
        enqueuePushNotification(
          {
            type: "push_to_user",
            clinicId,
            userId: mentionedUserId,
            title: `${user.name ?? "מישהו"} אזכר אותך`,
            body: body.slice(0, 80),
            tag: `shift-chat-mention-${message!.id}`,
            priority: "HIGH",
            idempotencyKey,
          },
          async () => { await sendPushToUser(clinicId, mentionedUserId, { title: `${user.name ?? "מישהו"} אזכר אותך`, body: body.slice(0, 80), tag: `shift-chat-mention-${message!.id}` }); },
        ).catch(() => {});
      }

      // URGENT flag → CRITICAL priority push to all shift members
      if (isUrgent) {
        for (const role of ["technician", "vet"] as const) {
          const idempotencyKey = `shift-chat-urgent-${message!.id}-${role}`;
          enqueuePushNotification(
            {
              type: "push_to_role",
              clinicId,
              role,
              title: "⚡ הודעה דחופה במשמרת",
              body: body.slice(0, 80),
              tag: `shift-chat-urgent-${message!.id}`,
              priority: "CRITICAL",
              idempotencyKey,
            },
            async () => { await sendPushToRole(clinicId, role, { title: "⚡ הודעה דחופה במשמרת", body: body.slice(0, 80), tag: `shift-chat-urgent-${message!.id}` }); },
          ).catch(() => {});
        }
      }

      // Broadcast → NORMAL priority push to all technicians
      if (type === "broadcast" && broadcastKey) {
        const template = BROADCAST_TEMPLATES[broadcastKey]!;
        for (const role of ["technician", "senior_technician"] as const) {
          const idempotencyKey = `shift-chat-broadcast-${message!.id}-${role}`;
          enqueuePushNotification(
            {
              type: "push_to_role",
              clinicId,
              role,
              title: `📢 ${template.label}`,
              body: template.subtitle,
              tag: `shift-chat-broadcast-${message!.id}`,
              priority: "NORMAL",
              idempotencyKey,
            },
            async () => { await sendPushToRole(clinicId, role, { title: `📢 ${template.label}`, body: template.subtitle, tag: `shift-chat-broadcast-${message!.id}` }); },
          ).catch(() => {});
        }
      }

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "shift_chat_message_posted",
        performedBy: user.id,
        performedByEmail: user.email ?? "",
        targetId: message!.id,
        targetType: "shift_message",
        metadata: { type, isUrgent },
      });

      return res.status(201).json({ message });
    } catch (err) {
      console.error("[shift-chat] POST /messages error:", err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", message: "Internal server error" }));
    }
  },
);

// ─── POST /api/shift-chat/messages/:id/ack ───────────────────────────────────

const ackSchema = z.object({
  status: z.enum(["acknowledged", "snoozed"]),
});

router.post(
  "/messages/:id/ack",
  requireAuth,
  requireEffectiveRole("technician"),
  writeLimiter,
  validateBody(ackSchema),
  async (req, res) => {
    const clinicId  = req.clinicId!;
    const userId    = req.authUser!.id;
    const messageId = req.params.id;
    const { status } = req.body as z.infer<typeof ackSchema>;

    try {
      // Verify the message exists and belongs to this clinic
      const [message] = await db
        .select()
        .from(shiftMessages)
        .where(and(eq(shiftMessages.id, messageId), eq(shiftMessages.clinicId, clinicId)))
        .limit(1);

      if (!message) {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "MESSAGE_NOT_FOUND", message: "Message not found" }));
      }
      // Fix A: allow acks on broadcast and system messages; block regular user messages.
      if (message.type === "regular") {
        return res.status(400).json(apiError({ code: "BAD_REQUEST", reason: "REGULAR_MESSAGE_NOT_ACKABLE", message: "Regular user messages cannot be acknowledged — only broadcast and system messages support acknowledgement" }));
      }

      const respondedAt = new Date();
      let shiftSnoozeNotificationOutboxId: number | undefined;
      await db.transaction(async (tx) => {
        await tx
          .insert(shiftMessageAcks)
          .values({ messageId, userId, status, respondedAt })
          .onConflictDoUpdate({
            target: [shiftMessageAcks.messageId, shiftMessageAcks.userId],
            set: { status, respondedAt },
          });

        if (status === "snoozed" && message.broadcastKey) {
          shiftSnoozeNotificationOutboxId = await insertRealtimeDomainEvent(tx, {
            clinicId,
            type: "NOTIFICATION_REQUESTED",
            payload: {
              channel: "shift_chat_snooze",
              messageId,
              userId,
              broadcastKey: message.broadcastKey,
            },
            occurredAt: respondedAt,
          });
        }
      });

      // Snooze: enqueue a push notification after 5 minutes (after ack TX commits)
      if (status === "snoozed" && message.broadcastKey) {
        await enqueueNotificationJob(
          {
            type: "shift_chat_snooze",
            clinicId,
            userId,
            messageId,
            broadcastKey: message.broadcastKey,
            ...(shiftSnoozeNotificationOutboxId !== undefined
              ? { notificationRequestOutboxId: shiftSnoozeNotificationOutboxId }
              : {}),
          },
          { delay: 300000 },
        );
      }

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "shift_chat_broadcast_ack",
        performedBy: userId,
        performedByEmail: req.authUser!.email ?? "",
        targetId: messageId,
        targetType: "shift_message",
        metadata: { status },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("[shift-chat] POST /messages/:id/ack error:", err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", message: "Internal server error" }));
    }
  },
);

// ─── POST /api/shift-chat/messages/:id/pin ───────────────────────────────────
// Allowed: doctor (vet, level 30), senior_technician (level 25), admin (level 40)
// requireEffectiveRole("senior_technician") covers all three since vet (30) >= senior_tech (25)

router.post(
  "/messages/:id/pin",
  requireAuth,
  requireEffectiveRole("senior_technician"),
  async (req, res) => {
    const clinicId  = req.clinicId!;
    const userId    = req.authUser!.id;
    const messageId = req.params.id;

    try {
      const shiftWindow = await getRequestShiftWindow(req);
      if (!shiftWindow) {
        return res.status(409).json(apiError({ code: "CONFLICT", reason: "NO_OPEN_SHIFT", message: "No active shift" }));
      }

      // Unpin all pinned messages inside the current window
      await db
        .update(shiftMessages)
        .set({ pinnedAt: null, pinnedByUserId: null })
        .where(
          and(
            windowMessagesWhere(clinicId, shiftWindow),
            isNotNull(shiftMessages.pinnedAt),
          ),
        );

      // Pin the target message (must belong to the current window)
      const now = new Date();
      const [updated] = await db
        .update(shiftMessages)
        .set({ pinnedAt: now, pinnedByUserId: userId })
        .where(and(
          eq(shiftMessages.id, messageId),
          windowMessagesWhere(clinicId, shiftWindow),
        ))
        .returning();

      if (!updated) {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "MESSAGE_NOT_FOUND", message: "Message not found" }));
      }

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "shift_chat_message_pinned",
        performedBy: userId,
        performedByEmail: req.authUser!.email ?? "",
        targetId: messageId,
        targetType: "shift_message",
      });

      return res.json({ ok: true, pinnedAt: now });
    } catch (err) {
      console.error("[shift-chat] POST /messages/:id/pin error:", err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", message: "Internal server error" }));
    }
  },
);

// ─── POST /api/shift-chat/reactions ──────────────────────────────────────────

const reactionSchema = z.object({
  messageId: z.string(),
  emoji: z.enum(["👍", "✅", "👀"]),
});

router.post(
  "/reactions",
  requireAuth,
  requireEffectiveRole("technician"),
  writeLimiter,
  validateBody(reactionSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const userId   = req.authUser!.id;
    const { messageId, emoji } = req.body as z.infer<typeof reactionSchema>;

    try {
      // Verify message belongs to clinic
      const [message] = await db
        .select({ id: shiftMessages.id })
        .from(shiftMessages)
        .where(and(eq(shiftMessages.id, messageId), eq(shiftMessages.clinicId, clinicId)))
        .limit(1);

      if (!message) {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "MESSAGE_NOT_FOUND", message: "Message not found" }));
      }

      // Toggle: delete if exists, insert if not
      const existing = await db
        .select()
        .from(shiftMessageReactions)
        .where(
          and(
            eq(shiftMessageReactions.messageId, messageId),
            eq(shiftMessageReactions.userId, userId),
            eq(shiftMessageReactions.emoji, emoji),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .delete(shiftMessageReactions)
          .where(
            and(
              eq(shiftMessageReactions.messageId, messageId),
              eq(shiftMessageReactions.userId, userId),
              eq(shiftMessageReactions.emoji, emoji),
            ),
          );
        logAudit({
          actorRole: resolveAuditActorRole(req),
          clinicId,
          actionType: "shift_chat_reaction_removed",
          performedBy: userId,
          performedByEmail: req.authUser!.email ?? "",
          targetId: messageId,
          targetType: "shift_message",
          metadata: { emoji },
        });
        return res.json({ action: "removed" });
      }

      await db
        .insert(shiftMessageReactions)
        .values({ messageId, userId, emoji });

      logAudit({
        actorRole: resolveAuditActorRole(req),
        clinicId,
        actionType: "shift_chat_reaction_added",
        performedBy: userId,
        performedByEmail: req.authUser!.email ?? "",
        targetId: messageId,
        targetType: "shift_message",
        metadata: { emoji },
      });

      return res.json({ action: "added" });
    } catch (err) {
      console.error("[shift-chat] POST /reactions error:", err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", message: "Internal server error" }));
    }
  },
);

// ─── GET /api/shift-chat/archive/:shiftId ────────────────────────────────────
// Read-only history for a completed shift. Accessible to senior_technician + admin.

router.get(
  "/archive/:shiftId",
  requireAuth,
  requireEffectiveRole("senior_technician"),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const shiftId  = req.params.shiftId;

    try {
      const windowRef = parseWindowSessionId(shiftId);
      if (windowRef) {
        // Roster-window archive — synthetic ids have no vt_shift_sessions row.
        if (windowRef.clinicId !== clinicId) {
          return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SHIFT_NOT_FOUND", message: "Shift not found" }));
        }
        const [rosterRow] = await db
          .select()
          .from(shifts)
          .where(and(
            eq(shifts.clinicId, clinicId),
            eq(shifts.date, windowRef.date),
            eq(shifts.startTime, windowRef.startTime),
          ))
          .limit(1);

        if (rosterRow) {
          const bounds = windowBounds(rosterRow);
          const messages = await db
            .select()
            .from(shiftMessages)
            .where(windowMessagesWhere(clinicId, { id: shiftId, ...bounds }))
            .orderBy(asc(shiftMessages.createdAt));
          return res.json({
            messages,
            shift: { id: shiftId, clinicId, startedAt: bounds.startedAt.toISOString(), endedAt: bounds.endsAt.toISOString() },
          });
        }

        // Roster row purged — fall back to the stamped id so history stays readable.
        const messages = await db
          .select()
          .from(shiftMessages)
          .where(and(eq(shiftMessages.shiftSessionId, shiftId), eq(shiftMessages.clinicId, clinicId)))
          .orderBy(asc(shiftMessages.createdAt));
        return res.json({
          messages,
          shift: {
            id: shiftId,
            clinicId,
            startedAt: combineLocal(windowRef.date, windowRef.startTime, 0).toISOString(),
            endedAt: null,
          },
        });
      }

      const [shift] = await db
        .select()
        .from(shiftSessions)
        .where(and(eq(shiftSessions.id, shiftId), eq(shiftSessions.clinicId, clinicId)))
        .limit(1);

      if (!shift) {
        return res.status(404).json(apiError({ code: "NOT_FOUND", reason: "SHIFT_NOT_FOUND", message: "Shift not found" }));
      }

      const messages = await db
        .select()
        .from(shiftMessages)
        .where(and(eq(shiftMessages.shiftSessionId, shiftId), eq(shiftMessages.clinicId, clinicId)))
        .orderBy(asc(shiftMessages.createdAt));

      return res.json({ messages, shift });
    } catch (err) {
      console.error("[shift-chat] GET /archive/:shiftId error:", err);
      return res.status(500).json(apiError({ code: "INTERNAL_ERROR", message: "Internal server error" }));
    }
  },
);

// ─── POST /api/shift-chat/typing ─────────────────────────────────────────────
// Lightweight — no DB write. Updates in-memory presence map only.

router.post(
  "/typing",
  requireAuth,
  requireEffectiveRole("technician"),
  writeLimiter,
  async (req, res) => {
    const clinicId = req.clinicId!;
    const userId   = req.authUser!.id;
    const name     = req.authUser!.name ?? "Unknown";
    touchPresence(clinicId, userId, name, true);
    return res.json({ ok: true });
  },
);

export default router;
