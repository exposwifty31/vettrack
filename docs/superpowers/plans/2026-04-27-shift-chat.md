# Shift Chat Implementation Plan

> **Historical snapshot — 2026-04-27.** This plan describes the original shift-chat polling architecture (3-second polling REST). VetTrack's current realtime transport is SSE-based; new realtime work should integrate with the outbox + reconciliation path documented in `CLAUDE.md` → "Realtime (Phase 9)".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shift-scoped group chat channel accessible via a floating FAB on every screen, with broadcast commands, 12 enrichment features, and system auto-posts from existing app events.

**Architecture:** 3-second polling REST API. Three new DB tables (`vt_shift_messages`, `vt_shift_message_acks`, `vt_shift_message_reactions`). In-memory TTL map for typing/presence (no DB write). System events auto-post via a shared `postSystemMessage()` utility hooked into existing handlers. Frontend is a floating FAB + slide-up Radix Sheet in a new `src/features/shift-chat/` feature folder.

**Tech Stack:** Express + Drizzle ORM + PostgreSQL, React 18 + React Query + Radix UI Sheet, BullMQ (snooze re-ping), web-push (notifications), TypeScript throughout.

---

## File Map

**New files:**
- `migrations/073_shift_chat.sql` — DB migration
- `server/lib/shift-chat-presence.ts` — in-memory presence/typing map + `postSystemMessage()` utility
- `server/routes/shift-chat.ts` — all 6 chat API endpoints
- `src/features/shift-chat/types.ts` — shared TypeScript types
- `src/features/shift-chat/api.ts` — API client functions
- `src/features/shift-chat/hooks/useShiftChat.ts` — polling hook + state
- `src/features/shift-chat/components/ShiftChatFab.tsx` — floating button with badge
- `src/features/shift-chat/components/ShiftChatPanel.tsx` — full panel with all sections
- `src/features/shift-chat/components/MessageBubble.tsx` — regular chat bubble with reactions
- `src/features/shift-chat/components/BroadcastCard.tsx` — broadcast command card
- `src/features/shift-chat/components/SystemCard.tsx` — auto-posted event cards
- `server/tests/shift-chat.test.ts` — integration tests

**Modified files:**
- `server/db.ts` — add 3 new table exports
- `server/app/routes.ts` — register `/api/shift-chat` router
- `server/lib/queue.ts` — add `shift_chat_snooze` job variant to `NotificationJobData`
- `server/workers/notification.worker.ts` — handle snooze job
- `server/routes/code-blue.ts` — hook `postSystemMessage` on session start/end
- `server/routes/shift-handover.ts` — hook `postSystemMessage` on shift end
- `server/services/medication-tasks.service.ts` — hook `postSystemMessage` on critical task creation
- `server/routes/patients.ts` — hook `postSystemMessage` on status→critical and discharge
- `server/workers/inventory-deduction.worker.ts` — hook `postSystemMessage` on low stock
- `src/main.tsx` — mount `<ShiftChatFab />` globally
- `src/lib/api.ts` — add `shiftChat` namespace

---

## Task 1: DB Schema — Three New Tables

**Files:**
- Modify: `server/db.ts`
- Create: `migrations/073_shift_chat.sql`

- [ ] **Step 1: Add table definitions to `server/db.ts`**

Open `server/db.ts`. At the very end of the file (after the last `export const` table definition, before any closing exports), add:

```typescript
export const shiftMessages = pgTable(
  "vt_shift_messages",
  {
    id: text("id").primaryKey(),
    shiftSessionId: text("shift_session_id")
      .notNull()
      .references(() => shiftSessions.id, { onDelete: "cascade" }),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    senderId: text("sender_id").references(() => users.id, { onDelete: "set null" }),
    senderName: text("sender_name"),
    senderRole: text("sender_role"),
    body: text("body").notNull().default(""),
    type: text("type").notNull().default("regular"), // regular | broadcast | system
    broadcastKey: text("broadcast_key"),
    systemEventType: text("system_event_type"),
    systemEventPayload: jsonb("system_event_payload"),
    roomTag: text("room_tag"),
    isUrgent: boolean("is_urgent").notNull().default(false),
    mentionedUserIds: jsonb("mentioned_user_ids").notNull().default(sql`'[]'::jsonb`),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedByUserId: text("pinned_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shiftIdx: index("vt_shift_messages_shift_idx").on(table.shiftSessionId),
    clinicIdx: index("vt_shift_messages_clinic_idx").on(table.clinicId),
    createdIdx: index("vt_shift_messages_created_idx").on(table.createdAt),
  }),
);

export const shiftMessageAcks = pgTable("vt_shift_message_acks", {
  messageId: text("message_id")
    .notNull()
    .references(() => shiftMessages.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // acknowledged | snoozed
  respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shiftMessageReactions = pgTable("vt_shift_message_reactions", {
  messageId: text("message_id")
    .notNull()
    .references(() => shiftMessages.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(), // 👍 | ✅ | 👀
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Note: `jsonb`, `boolean`, `index`, `sql` are already imported in `server/db.ts`. Verify at the top of the file. If `boolean` is missing, add it to the `drizzle-orm/pg-core` import line.

- [ ] **Step 2: Create migration file `migrations/073_shift_chat.sql`**

```sql
-- Shift chat: messages, broadcast acks, emoji reactions

CREATE TABLE IF NOT EXISTS vt_shift_messages (
  id                    TEXT PRIMARY KEY,
  shift_session_id      TEXT NOT NULL REFERENCES vt_shift_sessions(id) ON DELETE CASCADE,
  clinic_id             TEXT NOT NULL REFERENCES vt_clinics(id) ON DELETE CASCADE,
  sender_id             TEXT REFERENCES vt_users(id) ON DELETE SET NULL,
  sender_name           TEXT,
  sender_role           TEXT,
  body                  TEXT NOT NULL DEFAULT '',
  type                  TEXT NOT NULL DEFAULT 'regular'
                          CHECK (type IN ('regular', 'broadcast', 'system')),
  broadcast_key         TEXT,
  system_event_type     TEXT,
  system_event_payload  JSONB,
  room_tag              TEXT,
  is_urgent             BOOLEAN NOT NULL DEFAULT FALSE,
  mentioned_user_ids    JSONB NOT NULL DEFAULT '[]'::JSONB,
  pinned_at             TIMESTAMPTZ,
  pinned_by_user_id     TEXT REFERENCES vt_users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vt_shift_messages_shift_idx   ON vt_shift_messages (shift_session_id);
CREATE INDEX IF NOT EXISTS vt_shift_messages_clinic_idx  ON vt_shift_messages (clinic_id);
CREATE INDEX IF NOT EXISTS vt_shift_messages_created_idx ON vt_shift_messages (created_at);

CREATE TABLE IF NOT EXISTS vt_shift_message_acks (
  message_id    TEXT NOT NULL REFERENCES vt_shift_messages(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES vt_users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('acknowledged', 'snoozed')),
  responded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS vt_shift_message_reactions (
  message_id  TEXT NOT NULL REFERENCES vt_shift_messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES vt_users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);
```

- [ ] **Step 3: Run the migration**

```bash
cd C:/Users/Dan/Documents/GitHub/VetTrack
npx tsx server/migrate.ts
```

Expected: migration runs without errors, `vt_shift_messages`, `vt_shift_message_acks`, `vt_shift_message_reactions` tables created.

- [ ] **Step 4: Commit**

```bash
git add server/db.ts migrations/073_shift_chat.sql
git commit -m "feat(shift-chat): add DB schema — 3 new tables + migration 073"
```

---

## Task 2: Presence / Typing Map + `postSystemMessage` Utility

**Files:**
- Create: `server/lib/shift-chat-presence.ts`

- [ ] **Step 1: Create `server/lib/shift-chat-presence.ts`**

```typescript
import { randomUUID } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, shiftMessages, shiftSessions } from "../db.js";

// ─── In-memory presence/typing map ────────────────────────────────────────────
// Resets on server restart — presence is ephemeral by design.

interface PresenceEntry {
  name: string;
  typingUntil: number; // epoch ms
  lastSeenAt: number;  // epoch ms
}

const presenceMap = new Map<string, Map<string, PresenceEntry>>();
// shape: presenceMap.get(clinicId)?.get(userId)

const ONLINE_TTL_MS  = 5 * 60 * 1000; // 5 minutes
const TYPING_TTL_MS  = 3 * 1000;      // 3 seconds

export function touchPresence(clinicId: string, userId: string, name: string, typing = false): void {
  let clinic = presenceMap.get(clinicId);
  if (!clinic) {
    clinic = new Map();
    presenceMap.set(clinicId, clinic);
  }
  const now = Date.now();
  const existing = clinic.get(userId);
  clinic.set(userId, {
    name,
    typingUntil: typing ? now + TYPING_TTL_MS : (existing?.typingUntil ?? 0),
    lastSeenAt: now,
  });
}

export function getPresence(clinicId: string): { onlineUserIds: string[]; typing: string[] } {
  const clinic = presenceMap.get(clinicId);
  if (!clinic) return { onlineUserIds: [], typing: [] };

  const now = Date.now();
  const onlineUserIds: string[] = [];
  const typing: string[] = [];

  for (const [userId, entry] of clinic.entries()) {
    if (now - entry.lastSeenAt < ONLINE_TTL_MS) onlineUserIds.push(userId);
    if (entry.typingUntil > now) typing.push(entry.name);
  }

  return { onlineUserIds, typing };
}

// ─── System message auto-poster ───────────────────────────────────────────────
// Call from any server handler to post a system card to the active shift channel.
// No-op when no shift is open for the clinic.

export async function postSystemMessage(
  clinicId: string,
  systemEventType: string,
  systemEventPayload: Record<string, unknown>,
): Promise<void> {
  try {
    const [shift] = await db
      .select({ id: shiftSessions.id })
      .from(shiftSessions)
      .where(and(eq(shiftSessions.clinicId, clinicId), isNull(shiftSessions.endedAt)))
      .limit(1);

    if (!shift) return; // No open shift — silent no-op

    await db.insert(shiftMessages).values({
      id: randomUUID(),
      shiftSessionId: shift.id,
      clinicId,
      senderId: null,
      senderName: null,
      senderRole: null,
      body: "",
      type: "system",
      broadcastKey: null,
      systemEventType,
      systemEventPayload,
      roomTag: null,
      isUrgent: false,
      mentionedUserIds: [],
      pinnedAt: null,
      pinnedByUserId: null,
    });
  } catch (err) {
    // Never throw — system messages are best-effort
    console.error("[shift-chat] postSystemMessage failed:", err);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd C:/Users/Dan/Documents/GitHub/VetTrack
npx tsc --noEmit 2>&1 | grep shift-chat-presence
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add server/lib/shift-chat-presence.ts
git commit -m "feat(shift-chat): add presence map and postSystemMessage utility"
```

---

## Task 3: GET Messages Endpoint + Route Registration

**Files:**
- Create: `server/routes/shift-chat.ts`
- Modify: `server/app/routes.ts`

- [ ] **Step 1: Write the failing test for GET messages**

Create `server/tests/shift-chat.test.ts`:

```typescript
const BASE = "http://localhost:3001";

let passed = 0;
let failed = 0;

function ok(label: string) { console.log(`  ✅ PASS: ${label}`); passed++; }
function fail(label: string, detail?: string) { console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); failed++; }

async function get(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, opts);
}
async function post(path: string, body?: unknown, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
}

async function testGetMessagesRequiresAuth() {
  console.log("\n[Test] GET /api/shift-chat/messages — requires auth");
  const res = await get("/api/shift-chat/messages");
  if (res.status === 401) {
    ok("Unauthenticated request returns 401");
  } else {
    fail(`Expected 401, got ${res.status}`);
  }
}

async function testGetMessagesStudentDenied() {
  console.log("\n[Test] GET /api/shift-chat/messages — student gets 403");
  const res = await get("/api/shift-chat/messages", {
    headers: { "x-dev-role-override": "student" },
  });
  if (res.status === 403) {
    ok("Student correctly denied");
  } else {
    fail(`Expected 403, got ${res.status}`);
  }
}

async function testGetMessagesReturnsShape() {
  console.log("\n[Test] GET /api/shift-chat/messages — returns correct shape");
  const res = await get("/api/shift-chat/messages", {
    headers: { "x-dev-role-override": "technician" },
  });
  if (!res.ok) { fail(`Expected 200, got ${res.status}`); return; }
  const body = await res.json();
  if (
    Array.isArray(body.messages) &&
    ("pinnedMessage" in body) &&
    Array.isArray(body.typing) &&
    Array.isArray(body.onlineUserIds)
  ) {
    ok("Response has correct shape");
  } else {
    fail("Response missing required fields", JSON.stringify(body));
  }
}

async function run() {
  console.log("=== Shift Chat Tests ===");
  try {
    const health = await get("/api/healthz");
    if (!health.ok) throw new Error(`healthz ${health.status}`);
    console.log("Server reachable ✓\n");
  } catch {
    console.error("Server not reachable — start with: pnpm dev");
    process.exit(1);
  }

  await testGetMessagesRequiresAuth();
  await testGetMessagesStudentDenied();
  await testGetMessagesReturnsShape();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd C:/Users/Dan/Documents/GitHub/VetTrack
npx tsx server/tests/shift-chat.test.ts
```

Expected: `testGetMessagesRequiresAuth` passes (404 from missing route acts like not found), others fail with unexpected status codes.

- [ ] **Step 3: Create `server/routes/shift-chat.ts` with GET endpoint**

```typescript
import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  db, shiftMessages, shiftMessageAcks, shiftMessageReactions, shiftSessions, users,
} from "../db.js";
import { requireAuth, requireEffectiveRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { touchPresence, getPresence } from "../lib/shift-chat-presence.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";
import type { PushPayload } from "../lib/push.js";

const router = Router();

function apiError(code: string, reason: string, message: string) {
  return { code, error: code, reason, message };
}

/** Returns the open shift session for a clinic, or null. */
async function getOpenShift(clinicId: string) {
  const [row] = await db
    .select()
    .from(shiftSessions)
    .where(and(eq(shiftSessions.clinicId, clinicId), isNull(shiftSessions.endedAt)))
    .limit(1);
  return row ?? null;
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

    const shift = await getOpenShift(clinicId);
    if (!shift) {
      return res.json({ messages: [], pinnedMessage: null, typing: [], onlineUserIds: [] });
    }

    const afterDate = after ? new Date(after) : undefined;

    const rows = await db
      .select()
      .from(shiftMessages)
      .where(
        and(
          eq(shiftMessages.shiftSessionId, shift.id),
          afterDate ? gt(shiftMessages.createdAt, afterDate) : undefined,
        ),
      )
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

    // Find pinned message
    const pinnedRow = rows.findLast((m) => m.pinnedAt !== null) ?? null;

    const messages = rows.map((m) => ({
      ...m,
      acks: acksMap.get(m.id) ?? [],
      reactions: reactionsMap.get(m.id) ?? [],
    }));

    const presence = getPresence(clinicId);

    return res.json({
      messages,
      pinnedMessage: pinnedRow
        ? { ...pinnedRow, acks: [], reactions: [] }
        : null,
      typing: presence.typing,
      onlineUserIds: presence.onlineUserIds,
    });
  },
);

export default router;
```

- [ ] **Step 4: Register the route in `server/app/routes.ts`**

Add this import at the top of `server/app/routes.ts` alongside the other route imports:

```typescript
import shiftChatRoutes from "../routes/shift-chat.js";
```

Add this line inside `registerApiRoutes()` alongside the other `app.use` calls:

```typescript
app.use("/api/shift-chat", shiftChatRoutes);
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx tsx server/tests/shift-chat.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/shift-chat.ts server/app/routes.ts server/tests/shift-chat.test.ts
git commit -m "feat(shift-chat): GET /messages endpoint with presence + test scaffold"
```

---

## Task 4: POST Message (Regular + Broadcast) + Push Notifications

**Files:**
- Modify: `server/routes/shift-chat.ts`
- Modify: `server/tests/shift-chat.test.ts`

- [ ] **Step 1: Add POST message tests to `server/tests/shift-chat.test.ts`**

Add these functions before the `run()` call:

```typescript
async function testPostMessageRequiresAuth() {
  console.log("\n[Test] POST /api/shift-chat/messages — requires auth");
  const res = await post("/api/shift-chat/messages", { body: "hello", type: "regular" });
  if (res.status === 401) {
    ok("Unauthenticated returns 401");
  } else {
    fail(`Expected 401, got ${res.status}`);
  }
}

async function testBroadcastForbiddenForTechnician() {
  console.log("\n[Test] POST broadcast — technician gets 403");
  const res = await post(
    "/api/shift-chat/messages",
    { body: "", type: "broadcast", broadcastKey: "department_close" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  if (res.status === 403) {
    ok("Technician cannot send broadcast");
  } else {
    fail(`Expected 403, got ${res.status}`);
  }
}

async function testMessageBodyMaxLength() {
  console.log("\n[Test] POST /api/shift-chat/messages — body > 1000 chars rejected");
  const res = await post(
    "/api/shift-chat/messages",
    { body: "x".repeat(1001), type: "regular" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  if (res.status === 400) {
    ok("Body > 1000 chars rejected");
  } else {
    fail(`Expected 400, got ${res.status}`);
  }
}
```

Add calls in `run()`:

```typescript
await testPostMessageRequiresAuth();
await testBroadcastForbiddenForTechnician();
await testMessageBodyMaxLength();
```

- [ ] **Step 2: Run tests — verify new tests fail (route returns wrong codes)**

```bash
npx tsx server/tests/shift-chat.test.ts
```

Expected: new tests fail.

- [ ] **Step 3: Add Zod schema and POST handler to `server/routes/shift-chat.ts`**

Add after the GET handler (before `export default router`):

```typescript
// ─── POST /api/shift-chat/messages ───────────────────────────────────────────

const BROADCAST_TEMPLATES: Record<string, { label: string; subtitle: string }> = {
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
  validateBody(postMessageSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const user = req.authUser!;
    const { body, type, broadcastKey, roomTag, isUrgent, mentionedUserIds } =
      req.body as z.infer<typeof postMessageSchema>;

    // Broadcast requires senior_technician or admin
    if (type === "broadcast") {
      const role = req.effectiveRole ?? user.role;
      if (role !== "senior_technician" && role !== "admin" && user.role !== "admin") {
        return res.status(403).json(apiError("FORBIDDEN", "BROADCAST_FORBIDDEN", "Only senior technicians can send broadcasts"));
      }
      if (!broadcastKey || !BROADCAST_TEMPLATES[broadcastKey]) {
        return res.status(400).json(apiError("BAD_REQUEST", "INVALID_BROADCAST_KEY", "Unknown broadcast key"));
      }
    }

    const shift = await getOpenShift(clinicId);
    if (!shift) {
      return res.status(409).json(apiError("CONFLICT", "NO_OPEN_SHIFT", "No active shift for this clinic"));
    }

    const [message] = await db
      .insert(shiftMessages)
      .values({
        id: randomUUID(),
        shiftSessionId: shift.id,
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

    // ── Push notifications ──────────────────────────────────────────────────

    // @mentions → push to each mentioned user
    for (const mentionedUserId of mentionedUserIds) {
      const payload: PushPayload = {
        title: `${user.name ?? "מישהו"} אזכר אותך`,
        body: body.slice(0, 80),
        tag: `shift-chat-mention-${message!.id}`,
      };
      sendPushToUser(clinicId, mentionedUserId, payload).catch(() => {});
    }

    // URGENT flag → push to all shift members
    if (isUrgent) {
      const payload: PushPayload = {
        title: "⚡ הודעה דחופה במשמרת",
        body: body.slice(0, 80),
        tag: `shift-chat-urgent-${message!.id}`,
      };
      sendPushToRole(clinicId, "technician", payload).catch(() => {});
      sendPushToRole(clinicId, "vet", payload).catch(() => {});
    }

    // Broadcast → push to all technicians
    if (type === "broadcast") {
      const template = BROADCAST_TEMPLATES[broadcastKey!]!;
      const payload: PushPayload = {
        title: `📢 ${template.label}`,
        body: template.subtitle,
        tag: `shift-chat-broadcast-${message!.id}`,
      };
      sendPushToRole(clinicId, "technician", payload).catch(() => {});
      sendPushToRole(clinicId, "senior_technician", payload).catch(() => {});
    }

    return res.status(201).json({ message });
  },
);
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npx tsx server/tests/shift-chat.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/shift-chat.ts server/tests/shift-chat.test.ts
git commit -m "feat(shift-chat): POST /messages with broadcast RBAC and push notifications"
```

---

## Task 5: Broadcast Ack + Snooze (BullMQ)

**Files:**
- Modify: `server/routes/shift-chat.ts`
- Modify: `server/lib/queue.ts`
- Modify: `server/workers/notification.worker.ts`
- Modify: `server/tests/shift-chat.test.ts`

- [ ] **Step 1: Add `shift_chat_snooze` job type to `server/lib/queue.ts`**

Find the `NotificationJobData` union type. Add this variant to the union:

```typescript
  | {
      type: "shift_chat_snooze";
      clinicId: string;
      userId: string;
      messageId: string;
      broadcastKey: string;
    }
```

- [ ] **Step 2: Handle snooze job in `server/workers/notification.worker.ts`**

Find the `processSendNotification` function. Add a handler for the new job type:

```typescript
  if (data.type === "shift_chat_snooze") {
    const payload: PushPayload = {
      title: `📢 תזכורת: ${data.broadcastKey === "department_close" ? "סגירת מחלקה" : data.broadcastKey}`,
      body: "טרם אישרת קבלת הפקודה",
      tag: `shift-chat-snooze-${data.messageId}`,
    };
    await sendPushToUser(data.clinicId, data.userId, payload);
    return;
  }
```

Add the import for `sendPushToUser` and `PushPayload` if not already present in the worker file:

```typescript
import { sendPushToUser } from "../lib/push.js";
import type { PushPayload } from "../lib/push.js";
```

- [ ] **Step 3: Add ack tests to `server/tests/shift-chat.test.ts`**

```typescript
async function testAckInvalidStatus() {
  console.log("\n[Test] POST /api/shift-chat/messages/:id/ack — invalid status rejected");
  const res = await post(
    "/api/shift-chat/messages/fake-id/ack",
    { status: "invalid" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  if (res.status === 400) {
    ok("Invalid ack status returns 400");
  } else {
    fail(`Expected 400, got ${res.status}`);
  }
}

async function testAckRequiresAuth() {
  console.log("\n[Test] POST /api/shift-chat/messages/:id/ack — requires auth");
  const res = await post("/api/shift-chat/messages/fake-id/ack", { status: "acknowledged" });
  if (res.status === 401) {
    ok("Unauthenticated ack returns 401");
  } else {
    fail(`Expected 401, got ${res.status}`);
  }
}
```

Add both calls in `run()`.

- [ ] **Step 4: Add ack endpoint to `server/routes/shift-chat.ts`**

Add after the POST messages handler:

```typescript
// ─── POST /api/shift-chat/messages/:id/ack ───────────────────────────────────

const ackSchema = z.object({
  status: z.enum(["acknowledged", "snoozed"]),
});

router.post(
  "/messages/:id/ack",
  requireAuth,
  requireEffectiveRole("technician"),
  validateBody(ackSchema),
  async (req, res) => {
    const clinicId  = req.clinicId!;
    const userId    = req.authUser!.id;
    const messageId = req.params.id;
    const { status } = req.body as z.infer<typeof ackSchema>;

    // Verify the message exists and belongs to this clinic
    const [message] = await db
      .select()
      .from(shiftMessages)
      .where(and(eq(shiftMessages.id, messageId), eq(shiftMessages.clinicId, clinicId)))
      .limit(1);

    if (!message) {
      return res.status(404).json(apiError("NOT_FOUND", "MESSAGE_NOT_FOUND", "Message not found"));
    }
    if (message.type !== "broadcast") {
      return res.status(400).json(apiError("BAD_REQUEST", "NOT_BROADCAST", "Only broadcast messages can be acknowledged"));
    }

    // Upsert the ack record
    await db
      .insert(shiftMessageAcks)
      .values({ messageId, userId, status, respondedAt: new Date() })
      .onConflictDoUpdate({
        target: [shiftMessageAcks.messageId, shiftMessageAcks.userId],
        set: { status, respondedAt: new Date() },
      });

    // Snooze: enqueue a push notification after 5 minutes
    if (status === "snoozed" && message.broadcastKey) {
      const { enqueueNotificationJob } = await import("../lib/queue.js");
      await enqueueNotificationJob({
        type: "shift_chat_snooze",
        clinicId,
        userId,
        messageId,
        broadcastKey: message.broadcastKey,
      } as never); // cast until NotificationJobData union is updated in queue.ts
    }

    return res.json({ ok: true });
  },
);
```

Note: The `as never` cast is temporary. After updating `NotificationJobData` in Task 5 Step 1, change it to a direct type assertion:

```typescript
await enqueueNotificationJob({
  type: "shift_chat_snooze",
  clinicId,
  userId,
  messageId,
  broadcastKey: message.broadcastKey,
});
```

- [ ] **Step 5: Run tests**

```bash
npx tsx server/tests/shift-chat.test.ts
```

Expected: `testAckInvalidStatus` and `testAckRequiresAuth` pass.

- [ ] **Step 6: Commit**

```bash
git add server/routes/shift-chat.ts server/lib/queue.ts server/workers/notification.worker.ts server/tests/shift-chat.test.ts
git commit -m "feat(shift-chat): broadcast ack + 5-minute snooze via BullMQ"
```

---

## Task 6: Pin + Reactions + Typing Endpoints

**Files:**
- Modify: `server/routes/shift-chat.ts`

- [ ] **Step 1: Add pin, reactions, and typing endpoints to `server/routes/shift-chat.ts`**

Add all three handlers after the ack endpoint:

```typescript
// ─── POST /api/shift-chat/messages/:id/pin ───────────────────────────────────
// Allowed roles: doctor (vet, level 30), senior_technician (level 25), admin (level 40)
// requireEffectiveRole("senior_technician") covers all three since vet (30) >= senior_tech (25)

router.post(
  "/messages/:id/pin",
  requireAuth,
  requireEffectiveRole("senior_technician"),
  async (req, res) => {
    const clinicId  = req.clinicId!;
    const userId    = req.authUser!.id;
    const messageId = req.params.id;

    const shift = await getOpenShift(clinicId);
    if (!shift) {
      return res.status(409).json(apiError("CONFLICT", "NO_OPEN_SHIFT", "No active shift"));
    }

    // Unpin all current pinned messages for this shift
    await db
      .update(shiftMessages)
      .set({ pinnedAt: null, pinnedByUserId: null })
      .where(
        and(
          eq(shiftMessages.shiftSessionId, shift.id),
          eq(shiftMessages.clinicId, clinicId),
        ),
      );

    // Pin the target message
    const now = new Date();
    const [updated] = await db
      .update(shiftMessages)
      .set({ pinnedAt: now, pinnedByUserId: userId })
      .where(and(eq(shiftMessages.id, messageId), eq(shiftMessages.clinicId, clinicId)))
      .returning();

    if (!updated) {
      return res.status(404).json(apiError("NOT_FOUND", "MESSAGE_NOT_FOUND", "Message not found"));
    }

    return res.json({ ok: true, pinnedAt: now });
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
  validateBody(reactionSchema),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const userId   = req.authUser!.id;
    const { messageId, emoji } = req.body as z.infer<typeof reactionSchema>;

    // Verify message belongs to clinic
    const [message] = await db
      .select({ id: shiftMessages.id })
      .from(shiftMessages)
      .where(and(eq(shiftMessages.id, messageId), eq(shiftMessages.clinicId, clinicId)))
      .limit(1);

    if (!message) {
      return res.status(404).json(apiError("NOT_FOUND", "MESSAGE_NOT_FOUND", "Message not found"));
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
      return res.json({ action: "removed" });
    }

    await db
      .insert(shiftMessageReactions)
      .values({ messageId, userId, emoji });

    return res.json({ action: "added" });
  },
);

// ─── POST /api/shift-chat/typing ─────────────────────────────────────────────
// Lightweight — no DB write. Updates in-memory presence map only.

router.post(
  "/typing",
  requireAuth,
  requireEffectiveRole("technician"),
  async (req, res) => {
    const clinicId = req.clinicId!;
    const userId   = req.authUser!.id;
    const name     = req.authUser!.name ?? "Unknown";
    touchPresence(clinicId, userId, name, true);
    return res.json({ ok: true });
  },
);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep shift-chat
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/routes/shift-chat.ts
git commit -m "feat(shift-chat): pin, emoji reactions, and typing indicator endpoints"
```

---

## Task 7: System Hooks — Code Blue + Shift End + Medication + Hospitalization

**Files:**
- Modify: `server/routes/code-blue.ts`
- Modify: `server/routes/shift-handover.ts`
- Modify: `server/services/medication-tasks.service.ts`
- Modify: `server/routes/patients.ts`

- [ ] **Step 1: Hook Code Blue start in `server/routes/code-blue.ts`**

Find the POST handler that creates a new Code Blue session (search for `db.insert(codeBlueSessions)` or the handler at `router.post("/sessions"...)`).

Add the import at the top of the file:

```typescript
import { postSystemMessage } from "../lib/shift-chat-presence.js";
```

After the successful DB insert of a new Code Blue session, add:

```typescript
postSystemMessage(clinicId, "code_blue_start", {
  startedBy: req.authUser!.name ?? req.authUser!.id,
  startedAt: new Date().toISOString(),
}).catch(() => {});
```

- [ ] **Step 2: Hook Code Blue end in `server/routes/code-blue.ts`**

Find the PATCH/PUT handler that ends a Code Blue session (sets `endedAt` and `outcome`).

After the successful DB update, add:

```typescript
postSystemMessage(clinicId, "code_blue_end", {
  outcome: req.body.outcome ?? "unknown",
  endedAt: new Date().toISOString(),
}).catch(() => {});
```

- [ ] **Step 3: Hook shift end in `server/routes/shift-handover.ts`**

Find `POST /session/end` handler (around line 301). After the `.set({ endedAt, note: mergedNote })` update succeeds, add the import at the top:

```typescript
import { postSystemMessage } from "../lib/shift-chat-presence.js";
```

Then after the DB update line, add (use the handover summary data that is already queried in the same handler, or use basic fields):

```typescript
// Post shift summary system card to the chat (shift is still "open" at this point — do before marking end)
postSystemMessage(clinicId, "shift_summary", {
  endedAt: endedAt.toISOString(),
  note: mergedNote ?? null,
}).catch(() => {});
```

Note: call `postSystemMessage` **before** the `set({ endedAt })` update so the shift is still "open" when the utility checks.

- [ ] **Step 4: Hook critical medication task in `server/services/medication-tasks.service.ts`**

Find the `.insert(medicationTasks).values(...)` call around line 166. Add the import at the top:

```typescript
import { postSystemMessage } from "../lib/shift-chat-presence.js";
```

After the successful insert, check `result.safety.level` and post if critical:

```typescript
if (result.safety.level === "critical") {
  postSystemMessage(input.clinicId, "med_critical", {
    animalId:  input.animalId,
    drugName:  input.drugName ?? input.drugId,
    assignedTo: input.createdBy ?? null,
    assignedToName: input.createdByName ?? null,
  }).catch(() => {});
}
```

Note: the exact field names on `input` follow the service's existing parameter shape. Check what fields are passed to `createMedicationTask` and use the correct names.

- [ ] **Step 5: Hook hospitalization status change in `server/routes/patients.ts`**

Find `PATCH /api/patients/:id/status` (around line 322). Add the import at the top:

```typescript
import { postSystemMessage } from "../lib/shift-chat-presence.js";
```

After the successful `.update().set({ status })` call, add:

```typescript
const newStatus = parse.data.status;
if (newStatus === "critical" || newStatus === "discharged" || newStatus === "deceased") {
  postSystemMessage(clinicId, newStatus === "critical" ? "hosp_critical" : "hosp_discharged", {
    hospitalizationId: req.params.id,
    status: newStatus,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "shift-chat|patients|code-blue|shift-handover|medication"
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/routes/code-blue.ts server/routes/shift-handover.ts server/services/medication-tasks.service.ts server/routes/patients.ts
git commit -m "feat(shift-chat): hook system auto-posts into Code Blue, shift end, medication, and hospitalization handlers"
```

---

## Task 8: System Hooks — Equipment Overdue + Inventory Low Stock

**Files:**
- Modify: `server/lib/alert-reminder.ts`
- Modify: `server/workers/inventory-deduction.worker.ts`

- [ ] **Step 1: Hook equipment overdue in `server/lib/alert-reminder.ts`**

Open `server/lib/alert-reminder.ts`. Find the section that handles `alertType === "overdue"` (around line 23). Add the import at the top:

```typescript
import { postSystemMessage } from "./shift-chat-presence.js";
```

Inside the overdue handler, after the push notification is sent, add:

```typescript
postSystemMessage(clinicId, "equipment_overdue", {
  userId,
  equipmentId: alertData?.equipmentId ?? null,
  equipmentName: alertData?.equipmentName ?? null,
  minutesOverdue: alertData?.minutesOverdue ?? 60,
}).catch(() => {});
```

Note: adjust `alertData` fields to match what is actually available in the overdue handler's scope.

- [ ] **Step 2: Hook low stock in `server/workers/inventory-deduction.worker.ts`**

Open `server/workers/inventory-deduction.worker.ts`. Find where inventory is decremented. After a successful deduction, check if the remaining quantity is low and post:

```typescript
import { postSystemMessage } from "../lib/shift-chat-presence.js";

// After a successful deduction that results in low stock:
const remaining = updatedItem?.quantity ?? 0;
const minQty    = updatedItem?.minQuantity ?? 0;
if (minQty > 0 && remaining <= minQty) {
  postSystemMessage(clinicId, "low_stock", {
    itemId:   updatedItem.id,
    itemName: updatedItem.name,
    quantity: remaining,
    minQty,
  }).catch(() => {});
}
```

Note: the exact field names depend on the worker's item structure. Adapt to what is available in scope.

- [ ] **Step 3: Compile check**

```bash
npx tsc --noEmit 2>&1 | grep -E "alert-reminder|inventory-deduction"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/lib/alert-reminder.ts server/workers/inventory-deduction.worker.ts
git commit -m "feat(shift-chat): hook equipment overdue and low stock into system auto-posts"
```

---

## Task 9: Frontend Types + API Client

**Files:**
- Create: `src/features/shift-chat/types.ts`
- Create: `src/features/shift-chat/api.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Create `src/features/shift-chat/types.ts`**

```typescript
export type MessageType = "regular" | "broadcast" | "system";

export interface MessageReaction {
  userId: string;
  emoji: "👍" | "✅" | "👀";
}

export interface MessageAck {
  userId: string;
  status: "acknowledged" | "snoozed";
}

export interface ShiftMessage {
  id: string;
  shiftSessionId: string;
  clinicId: string;
  senderId: string | null;
  senderName: string | null;
  senderRole: string | null;
  body: string;
  type: MessageType;
  broadcastKey: string | null;
  systemEventType: string | null;
  systemEventPayload: Record<string, unknown> | null;
  roomTag: string | null;
  isUrgent: boolean;
  mentionedUserIds: string[];
  pinnedAt: string | null;
  pinnedByUserId: string | null;
  createdAt: string;
  acks: MessageAck[];
  reactions: MessageReaction[];
}

export interface MessagesResponse {
  messages: ShiftMessage[];
  pinnedMessage: ShiftMessage | null;
  typing: string[];
  onlineUserIds: string[];
}

export interface PostMessageInput {
  body: string;
  type: "regular" | "broadcast";
  broadcastKey?: string;
  roomTag?: string;
  isUrgent?: boolean;
  mentionedUserIds?: string[];
}

export const BROADCAST_TEMPLATES = {
  department_close: { label: "סגירת מחלקה", subtitle: "כל הטכנאים — לנקות ולסדר את המחלקה" },
} as const;

export type BroadcastKey = keyof typeof BROADCAST_TEMPLATES;
```

- [ ] **Step 2: Create `src/features/shift-chat/api.ts`**

```typescript
import { request } from "@/lib/api";
import type { MessagesResponse, PostMessageInput, ShiftMessage } from "./types";

export const shiftChatApi = {
  getMessages: (after?: string): Promise<MessagesResponse> => {
    const qs = after ? `?after=${encodeURIComponent(after)}` : "";
    return request<MessagesResponse>(`/api/shift-chat/messages${qs}`);
  },

  postMessage: (input: PostMessageInput): Promise<{ message: ShiftMessage }> =>
    request<{ message: ShiftMessage }>("/api/shift-chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  ackMessage: (messageId: string, status: "acknowledged" | "snoozed"): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/shift-chat/messages/${messageId}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),

  pinMessage: (messageId: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/shift-chat/messages/${messageId}/pin`, {
      method: "POST",
    }),

  react: (messageId: string, emoji: "👍" | "✅" | "👀"): Promise<{ action: string }> =>
    request<{ action: string }>("/api/shift-chat/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, emoji }),
    }),

  typing: (): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>("/api/shift-chat/typing", { method: "POST" }),
};
```

- [ ] **Step 3: Add `shiftChat` namespace to `src/lib/api.ts`**

Find the `export const api = {` block. Add the `shiftChat` namespace:

```typescript
import { shiftChatApi } from "@/features/shift-chat/api";

// Inside the api object:
shiftChat: shiftChatApi,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep shift-chat
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/shift-chat/types.ts src/features/shift-chat/api.ts src/lib/api.ts
git commit -m "feat(shift-chat): frontend types and API client"
```

---

## Task 10: `useShiftChat` Polling Hook

**Files:**
- Create: `src/features/shift-chat/hooks/useShiftChat.ts`

- [ ] **Step 1: Create `src/features/shift-chat/hooks/useShiftChat.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { shiftChatApi } from "../api";
import type { ShiftMessage, PostMessageInput } from "../types";
import { useAuth } from "@/hooks/use-auth";

const QUERY_KEY = ["/api/shift-chat/messages"] as const;
const POLL_INTERVAL_MS = 3_000;
const TYPING_DEBOUNCE_MS = 1_500;

export function useShiftChat(isOpen: boolean) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const afterRef    = useRef<string | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Poll for new messages ──────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => shiftChatApi.getMessages(afterRef.current),
    enabled: !!userId && isOpen,
    refetchInterval: isOpen ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });

  // Track the latest message timestamp for incremental polling
  useEffect(() => {
    if (data?.messages?.length) {
      afterRef.current = data.messages[data.messages.length - 1]!.createdAt;
    }
  }, [data?.messages]);

  // ── Local message accumulation ─────────────────────────────────────────────
  const [allMessages, setAllMessages] = useState<ShiftMessage[]>([]);

  useEffect(() => {
    if (!data?.messages?.length) return;
    setAllMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const newOnes = data.messages.filter((m) => !existingIds.has(m.id));
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
    });
  }, [data?.messages]);

  // Reset messages when panel closes (so next open loads fresh)
  useEffect(() => {
    if (!isOpen) {
      setAllMessages([]);
      afterRef.current = undefined;
    }
  }, [isOpen]);

  // ── Unread count ───────────────────────────────────────────────────────────
  const lastOpenRef  = useRef<number>(0);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
      lastOpenRef.current = Date.now();
      setUnreadCount(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen && data?.messages?.length) {
      const newCount = data.messages.filter(
        (m) => new Date(m.createdAt).getTime() > lastOpenRef.current,
      ).length;
      if (newCount > 0) setUnreadCount((n) => n + newCount);
    }
  }, [data?.messages, isOpen]);

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (input: PostMessageInput) => shiftChatApi.postMessage(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  // ── Ack broadcast ──────────────────────────────────────────────────────────
  const ackMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "acknowledged" | "snoozed" }) =>
      shiftChatApi.ackMessage(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  // ── Typing indicator (debounced) ───────────────────────────────────────────
  const notifyTyping = useCallback(() => {
    if (typingTimer.current) return; // Already sent recently
    shiftChatApi.typing().catch(() => {});
    typingTimer.current = setTimeout(() => {
      typingTimer.current = null;
    }, TYPING_DEBOUNCE_MS);
  }, []);

  // ── React ──────────────────────────────────────────────────────────────────
  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: "👍" | "✅" | "👀" }) =>
      shiftChatApi.react(messageId, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  // ── Pin ────────────────────────────────────────────────────────────────────
  const pinMutation = useMutation({
    mutationFn: (messageId: string) => shiftChatApi.pinMessage(messageId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    messages:      allMessages,
    pinnedMessage: data?.pinnedMessage ?? null,
    typing:        data?.typing ?? [],
    onlineUserIds: data?.onlineUserIds ?? [],
    isLoading,
    unreadCount,
    sendMessage:   sendMutation.mutate,
    isSending:     sendMutation.isPending,
    ackMessage:    ackMutation.mutate,
    reactToMessage: reactMutation.mutate,
    pinMessage:    pinMutation.mutate,
    notifyTyping,
    currentUserId: userId,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep useShiftChat
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/shift-chat/hooks/useShiftChat.ts
git commit -m "feat(shift-chat): polling hook with unread count, typing, and mutations"
```

---

## Task 11: Message Rendering Components

**Files:**
- Create: `src/features/shift-chat/components/MessageBubble.tsx`
- Create: `src/features/shift-chat/components/BroadcastCard.tsx`
- Create: `src/features/shift-chat/components/SystemCard.tsx`

- [ ] **Step 1: Create `src/features/shift-chat/components/MessageBubble.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { ShiftMessage } from "../types";

interface MessageBubbleProps {
  message: ShiftMessage;
  currentUserId: string | null;
  onReact: (emoji: "👍" | "✅" | "👀") => void;
  onPin?: () => void;
  canPin: boolean;
}

const EMOJIS = ["👍", "✅", "👀"] as const;

export function MessageBubble({ message, currentUserId, onReact, onPin, canPin }: MessageBubbleProps) {
  const isMe = message.senderId === currentUserId;

  // Count reactions
  const reactionCounts = EMOJIS.map((e) => ({
    emoji: e,
    count: message.reactions.filter((r) => r.emoji === e).length,
    mine:  message.reactions.some((r) => r.emoji === e && r.userId === currentUserId),
  })).filter((r) => r.count > 0);

  return (
    <div className={cn("flex gap-2 items-end", isMe && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0",
          message.senderRole === "vet" ? "bg-blue-950 text-blue-300" :
          message.senderRole === "senior_technician" ? "bg-purple-950 text-purple-300" :
          "bg-green-950 text-green-400",
        )}
      >
        {(message.senderName ?? "?").slice(0, 2)}
      </div>

      <div className={cn("max-w-[72%]", isMe && "items-end flex flex-col")}>
        {/* Sender name */}
        {!isMe && (
          <div className="text-[10px] text-muted-foreground mb-0.5">{message.senderName}</div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            "px-3 py-2 rounded-2xl text-sm leading-snug",
            isMe
              ? "bg-indigo-600 text-white rounded-bl-sm"
              : "bg-muted text-foreground rounded-br-sm",
            message.isUrgent && "bg-red-950 border border-red-600 text-red-100",
          )}
        >
          {message.isUrgent && (
            <div className="text-[9px] font-bold text-red-300 tracking-wide mb-1">⚡ דחוף</div>
          )}
          <span
            dangerouslySetInnerHTML={{
              __html: message.body.replace(
                /@(\S+)/g,
                '<span class="text-indigo-300 font-semibold">@$1</span>',
              ).replace(
                /#(\S+)/g,
                '<span class="text-indigo-300 underline cursor-pointer font-semibold">#$1</span>',
              ),
            }}
          />
        </div>

        {/* Reactions */}
        {reactionCounts.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {reactionCounts.map(({ emoji, count, mine }) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji as "👍" | "✅" | "👀")}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                  mine
                    ? "bg-indigo-900 border-indigo-500 text-indigo-200"
                    : "bg-muted border-border text-muted-foreground",
                )}
              >
                {emoji} <span>{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Context menu: react + pin */}
        <div className={cn("flex gap-1 mt-1", isMe && "justify-end")}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => onReact(e)}
              className="text-xs opacity-30 hover:opacity-100 transition-opacity"
              title={`React with ${e}`}
            >
              {e}
            </button>
          ))}
          {canPin && (
            <button
              onClick={onPin}
              className="text-xs opacity-30 hover:opacity-100 transition-opacity ml-1"
              title="Pin message"
            >
              📌
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/features/shift-chat/components/BroadcastCard.tsx`**

```tsx
import { BROADCAST_TEMPLATES, type ShiftMessage, type MessageAck } from "../types";
import { cn } from "@/lib/utils";

interface BroadcastCardProps {
  message: ShiftMessage;
  currentUserId: string | null;
  isSender: boolean;
  onAck: (status: "acknowledged" | "snoozed") => void;
}

export function BroadcastCard({ message, currentUserId, isSender, onAck }: BroadcastCardProps) {
  const template = message.broadcastKey
    ? BROADCAST_TEMPLATES[message.broadcastKey as keyof typeof BROADCAST_TEMPLATES]
    : null;

  const myAck = message.acks.find((a) => a.userId === currentUserId);
  const totalTechs = message.acks.length;
  const ackedCount = message.acks.filter((a) => a.status === "acknowledged").length;

  return (
    <div className="rounded-xl border border-indigo-500 bg-indigo-950/60 p-3 my-1">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">📢</span>
        <span className="text-[11px] text-indigo-300 font-semibold">
          {isSender ? "שלחתי" : (message.senderName ?? "טכנאית בכירה")}
        </span>
      </div>

      {/* Body */}
      <div className="text-[15px] font-bold text-indigo-100 mb-0.5">
        {template?.label ?? message.broadcastKey}
      </div>
      {template?.subtitle && (
        <div className="text-[12px] text-indigo-300 mb-3">{template.subtitle}</div>
      )}

      {/* Sender view: progress bar */}
      {isSender && totalTechs > 0 && (
        <div className="mt-1">
          <div className="h-1 bg-indigo-900 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-green-400 rounded-full transition-all"
              style={{ width: `${(ackedCount / totalTechs) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-green-400 font-semibold mb-2">
            ✓ {ackedCount} / {totalTechs} קיבלו
          </div>
          <div className="flex flex-wrap gap-1">
            {message.acks.map((ack) => (
              <span
                key={ack.userId}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-semibold",
                  ack.status === "acknowledged"
                    ? "bg-green-950 text-green-400"
                    : "bg-red-950 text-red-400",
                )}
              >
                {ack.status === "acknowledged" ? "✓" : "⏳"} {ack.userId.slice(0, 6)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recipient view: action buttons */}
      {!isSender && !myAck && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onAck("acknowledged")}
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-[13px] font-bold transition-colors"
          >
            ✓ קיבלתי — בדרך
          </button>
          <button
            onClick={() => onAck("snoozed")}
            className="bg-transparent border border-indigo-700 text-indigo-300 rounded-lg px-3 py-2 text-[11px] transition-colors hover:border-indigo-400"
          >
            ⏱ 5 דק׳
          </button>
        </div>
      )}

      {/* Already responded */}
      {!isSender && myAck && (
        <div className="text-[11px] text-green-400 font-semibold">
          {myAck.status === "acknowledged" ? "✓ אישרת קבלה" : "⏱ נדחה — תזכורת בעוד 5 דקות"}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/features/shift-chat/components/SystemCard.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { ShiftMessage } from "../types";

interface SystemCardProps {
  message: ShiftMessage;
}

const EVENT_CONFIG: Record<
  string,
  { icon: string; colorClass: string; render: (p: Record<string, unknown>) => string }
> = {
  code_blue_start: {
    icon: "🚨",
    colorClass: "bg-red-950 border-red-800 text-red-200",
    render: (p) => `Code Blue הופעל — ${p.startedBy ?? ""}`,
  },
  code_blue_end: {
    icon: "✅",
    colorClass: "bg-green-950 border-green-800 text-green-200",
    render: (p) => `Code Blue הסתיים — ${p.outcome ?? ""} · ${p.endedAt ? new Date(p.endedAt as string).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : ""}`,
  },
  med_critical: {
    icon: "💊",
    colorClass: "bg-purple-950 border-purple-800 text-purple-200",
    render: (p) => `תרופה קריטית — ${p.drugName ?? ""} · ${p.assignedToName ?? ""}`,
  },
  hosp_critical: {
    icon: "🏥",
    colorClass: "bg-red-950 border-red-800 text-red-200",
    render: (p) => `חולה עבר לסטטוס קריטי`,
  },
  hosp_discharged: {
    icon: "🏥",
    colorClass: "bg-green-950 border-green-800 text-green-200",
    render: (p) => `חולה שוחרר`,
  },
  equipment_overdue: {
    icon: "🔧",
    colorClass: "bg-amber-950 border-amber-800 text-amber-200",
    render: (p) => `ציוד לא הוחזר — ${p.equipmentName ?? ""} (${p.minutesOverdue ?? 60} דק׳)`,
  },
  low_stock: {
    icon: "📦",
    colorClass: "bg-purple-950 border-purple-800 text-purple-200",
    render: (p) => `מלאי נמוך: ${p.itemName ?? ""} — נותרו ${p.quantity ?? 0} יחידות`,
  },
  shift_summary: {
    icon: "📋",
    colorClass: "bg-slate-900 border-slate-700 text-slate-400",
    render: (p) => `סיום משמרת · ${p.endedAt ? new Date(p.endedAt as string).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : ""}`,
  },
};

export function SystemCard({ message }: SystemCardProps) {
  const eventType = message.systemEventType ?? "";
  const payload   = (message.systemEventPayload ?? {}) as Record<string, unknown>;
  const config    = EVENT_CONFIG[eventType];

  if (!config) return null;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-[12px] text-center flex items-center justify-center gap-2",
        config.colorClass,
      )}
    >
      <span>{config.icon}</span>
      <span>{config.render(payload)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "MessageBubble|BroadcastCard|SystemCard"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/shift-chat/components/
git commit -m "feat(shift-chat): MessageBubble, BroadcastCard, and SystemCard rendering components"
```

---

## Task 12: ShiftChatFab + ShiftChatPanel

**Files:**
- Create: `src/features/shift-chat/components/ShiftChatFab.tsx`
- Create: `src/features/shift-chat/components/ShiftChatPanel.tsx`

- [ ] **Step 1: Create `src/features/shift-chat/components/ShiftChatFab.tsx`**

```tsx
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useShiftChat } from "../hooks/useShiftChat";
import { ShiftChatPanel } from "./ShiftChatPanel";
import { useAuth } from "@/hooks/use-auth";

export function ShiftChatFab() {
  const { role, effectiveRole } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  // Only render for shift-eligible roles
  const eligibleRoles = ["vet", "technician", "senior_technician", "admin"]; // "vet" is the DB role for doctors
  if (!eligibleRoles.includes(effectiveRole ?? role ?? "")) return null;

  const chat = useShiftChat(isOpen);

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-40",
          "w-12 h-12 rounded-full",
          "bg-gradient-to-br from-indigo-600 to-violet-700",
          "flex items-center justify-center text-xl shadow-lg shadow-indigo-500/40",
          "transition-transform hover:scale-105 active:scale-95",
        )}
        aria-label="פתח צ'אט משמרת"
      >
        💬
        {chat.unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-background">
            {chat.unreadCount > 9 ? "9+" : chat.unreadCount}
          </span>
        )}
      </button>

      <ShiftChatPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        chat={chat}
      />
    </>
  );
}
```

- [ ] **Step 2: Create `src/features/shift-chat/components/ShiftChatPanel.tsx`**

```tsx
import { useRef, useEffect, useState, useCallback } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { useShiftChat } from "../hooks/useShiftChat";
import { MessageBubble } from "./MessageBubble";
import { BroadcastCard } from "./BroadcastCard";
import { SystemCard } from "./SystemCard";
import { BROADCAST_TEMPLATES, type BroadcastKey } from "../types";
import { useAuth } from "@/hooks/use-auth";

type ChatState = ReturnType<typeof useShiftChat>;

interface ShiftChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chat: ChatState;
}

const UNIQUE_ROOM_TAGS = (msgs: { roomTag: string | null }[]) =>
  [...new Set(msgs.map((m) => m.roomTag).filter(Boolean))] as string[];

export function ShiftChatPanel({ isOpen, onClose, chat }: ShiftChatPanelProps) {
  const { role, effectiveRole, userId } = useAuth();
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const [body, setBody]               = useState("");
  const [isUrgent, setIsUrgent]       = useState(false);
  const [roomFilter, setRoomFilter]   = useState<string | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);

  const canSendBroadcast = effectiveRole === "senior_technician" ||
    effectiveRole === "admin" || role === "admin";
  const canPin = effectiveRole === "vet" || role === "vet" ||
    effectiveRole === "senior_technician" || effectiveRole === "admin" || role === "admin";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat.messages.length, isOpen]);

  const filteredMessages = roomFilter
    ? chat.messages.filter((m) => m.roomTag === roomFilter || m.type === "system")
    : chat.messages;

  const handleSend = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed && !showBroadcast) return;

    // Extract @mention user IDs (simplified — matches @word tokens in body)
    const mentionedNames = (trimmed.match(/@(\S+)/g) ?? []).map((t) => t.slice(1));

    chat.sendMessage({
      body: trimmed,
      type: "regular",
      isUrgent,
      mentionedUserIds: [], // Resolved server-side from names in a real implementation
    });

    setBody("");
    setIsUrgent(false);
  }, [body, isUrgent, chat, showBroadcast]);

  const handleBroadcast = (key: BroadcastKey) => {
    chat.sendMessage({ body: "", type: "broadcast", broadcastKey: key });
    setShowBroadcast(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    chat.notifyTyping();
  };

  const roomTags = UNIQUE_ROOM_TAGS(chat.messages);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="bottom" className="max-h-[92dvh] p-0 flex flex-col rounded-t-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_6px_theme(colors.green.500)]" />
            <span className="font-bold text-sm">צ׳אט משמרת</span>
            <span className="text-[11px] text-muted-foreground">
              {chat.onlineUserIds.length} מחוברים
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>

        {/* Pinned message */}
        {chat.pinnedMessage && (
          <div className="px-3 py-2 bg-amber-950/40 border-b border-amber-800/50 flex items-start gap-2 flex-shrink-0">
            <span className="text-xs">📌</span>
            <p className="text-[11px] text-amber-300 leading-snug line-clamp-2">
              {chat.pinnedMessage.body}
            </p>
          </div>
        )}

        {/* Room filter */}
        {roomTags.length > 0 && (
          <div className="flex gap-2 px-3 py-2 overflow-x-auto scrollbar-none border-b border-border flex-shrink-0">
            <button
              onClick={() => setRoomFilter(null)}
              className={cn(
                "px-3 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap",
                !roomFilter
                  ? "bg-blue-900 border-blue-500 text-blue-200"
                  : "bg-muted border-border text-muted-foreground",
              )}
            >
              הכל
            </button>
            {roomTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setRoomFilter(tag === roomFilter ? null : tag)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap",
                  roomFilter === tag
                    ? "bg-blue-900 border-blue-500 text-blue-200"
                    : "bg-muted border-border text-muted-foreground",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {chat.isLoading && (
            <p className="text-center text-muted-foreground text-xs">טוען...</p>
          )}
          {!chat.isLoading && filteredMessages.length === 0 && (
            <p className="text-center text-muted-foreground text-xs">אין הודעות עדיין</p>
          )}
          {filteredMessages.map((msg) => {
            if (msg.type === "system") {
              return <SystemCard key={msg.id} message={msg} />;
            }
            if (msg.type === "broadcast") {
              return (
                <BroadcastCard
                  key={msg.id}
                  message={msg}
                  currentUserId={userId ?? null}
                  isSender={msg.senderId === userId}
                  onAck={(status) => chat.ackMessage({ id: msg.id, status })}
                />
              );
            }
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                currentUserId={userId ?? null}
                onReact={(emoji) => chat.reactToMessage({ messageId: msg.id, emoji })}
                onPin={() => chat.pinMessage(msg.id)}
                canPin={canPin}
              />
            );
          })}

          {/* Typing indicator */}
          {chat.typing.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground italic px-1">
              <span>{chat.typing.join(", ")} מקליד...</span>
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Broadcast picker */}
        {showBroadcast && canSendBroadcast && (
          <div className="px-3 pb-2 border-t border-border flex-shrink-0">
            <p className="text-[10px] text-muted-foreground mb-2 pt-2">בחר פקודת שידור:</p>
            {(Object.entries(BROADCAST_TEMPLATES) as [BroadcastKey, { label: string; subtitle: string }][]).map(([key, t]) => (
              <button
                key={key}
                onClick={() => handleBroadcast(key)}
                className="w-full text-right bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 rounded-lg px-3 py-2 mb-1"
              >
                <div className="text-sm font-bold text-indigo-100">{t.label}</div>
                <div className="text-[10px] text-indigo-300">{t.subtitle}</div>
              </button>
            ))}
            <button onClick={() => setShowBroadcast(false)} className="text-[10px] text-muted-foreground mt-1">ביטול</button>
          </div>
        )}

        {/* Input bar */}
        <div className="px-3 pb-4 pt-2 border-t border-border flex items-center gap-2 flex-shrink-0">
          {canSendBroadcast && (
            <button
              onClick={() => setShowBroadcast((v) => !v)}
              className="bg-indigo-950 border border-indigo-700 text-indigo-400 rounded-lg p-2 text-sm flex-shrink-0"
              aria-label="שלח פקודה"
            >
              📢
            </button>
          )}
          <div className="flex-1 bg-background border border-border rounded-2xl flex items-center px-3 gap-2 min-h-[36px]">
            <textarea
              ref={inputRef}
              value={body}
              onChange={handleBodyChange}
              onKeyDown={handleKeyDown}
              placeholder="כתוב הודעה..."
              rows={1}
              className="flex-1 bg-transparent text-sm resize-none outline-none py-2 leading-snug"
              style={{ maxHeight: "80px" }}
            />
            <button
              onClick={() => setIsUrgent((v) => !v)}
              className={cn("text-sm flex-shrink-0", isUrgent ? "text-red-400" : "text-muted-foreground/40")}
              aria-label="סמן כדחוף"
            >
              ⚡
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={!body.trim() || chat.isSending}
            className="bg-gradient-to-br from-indigo-600 to-violet-700 text-white rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
            aria-label="שלח"
          >
            ➤
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "ShiftChatFab|ShiftChatPanel"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/shift-chat/components/ShiftChatFab.tsx src/features/shift-chat/components/ShiftChatPanel.tsx
git commit -m "feat(shift-chat): ShiftChatFab floating button and ShiftChatPanel slide-up sheet"
```

---

## Task 13: Wire FAB into App + Smoke Test

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Add `<ShiftChatFab />` to `src/main.tsx`**

Find the root render block. The explorer found it around line 120-164:

```tsx
const appShell = (
  <QueryClientProvider client={queryClient}>
    <SettingsProvider>
      <ClerkAuthProviderInner>
        <AppErrorBoundary>
          <SyncProvider>
            <AppBootstrap />
            <SwUpdateBanner />
            <SyncStatusBanner />
            <Toaster ... />
          </SyncProvider>
        </AppErrorBoundary>
      </ClerkAuthProviderInner>
    </SettingsProvider>
  </QueryClientProvider>
);
```

Add the import at the top of `src/main.tsx`:

```tsx
import { ShiftChatFab } from "@/features/shift-chat/components/ShiftChatFab";
```

Add `<ShiftChatFab />` after `<SyncStatusBanner />` and before `<Toaster />`:

```tsx
<SyncStatusBanner />
<ShiftChatFab />
<Toaster ... />
```

- [ ] **Step 2: Start dev server and verify FAB renders**

```bash
pnpm dev
```

Navigate to any page in the app. Verify the 💬 button appears in the bottom-right corner. Click it — the chat panel should slide up.

Expected: FAB visible, panel opens, "אין הודעות עדיין" shown if no active shift.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "feat(shift-chat): mount ShiftChatFab globally in app shell"
```

---

## Task 14: Archive View (Read-only)

**Files:**
- Modify: `server/routes/shift-chat.ts`
- Create: `src/features/shift-chat/components/ShiftChatArchive.tsx`
- Modify: `src/app/routes.tsx` (add archive route)

- [ ] **Step 1: Add archive endpoint to `server/routes/shift-chat.ts`**

Add before `export default router`:

```typescript
// ─── GET /api/shift-chat/archive/:shiftId ────────────────────────────────────
// Read-only history for a completed shift. Accessible to senior_technician + admin.

router.get(
  "/archive/:shiftId",
  requireAuth,
  requireEffectiveRole("senior_technician"),
  async (req, res) => {
    const clinicId    = req.clinicId!;
    const shiftId     = req.params.shiftId;

    // Verify shift belongs to this clinic
    const [shift] = await db
      .select()
      .from(shiftSessions)
      .where(and(eq(shiftSessions.id, shiftId), eq(shiftSessions.clinicId, clinicId)))
      .limit(1);

    if (!shift) {
      return res.status(404).json(apiError("NOT_FOUND", "SHIFT_NOT_FOUND", "Shift not found"));
    }

    const messages = await db
      .select()
      .from(shiftMessages)
      .where(eq(shiftMessages.shiftSessionId, shiftId))
      .orderBy(asc(shiftMessages.createdAt));

    return res.json({ messages, shift });
  },
);
```

- [ ] **Step 2: Create `src/features/shift-chat/components/ShiftChatArchive.tsx`**

```tsx
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import type { ShiftMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { BroadcastCard } from "./BroadcastCard";
import { SystemCard } from "./SystemCard";
import { useAuth } from "@/hooks/use-auth";

interface ArchiveResponse {
  messages: ShiftMessage[];
  shift: { id: string; startedAt: string; endedAt: string | null };
}

export function ShiftChatArchive() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { userId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/shift-chat/archive", shiftId],
    queryFn: () => request<ArchiveResponse>(`/api/shift-chat/archive/${shiftId}`),
    enabled: !!shiftId,
  });

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">טוען...</div>;
  if (!data) return <div className="p-6 text-muted-foreground text-sm">לא נמצא</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-3">
      <div className="mb-4">
        <h1 className="text-lg font-bold">ארכיון צ'אט משמרת</h1>
        <p className="text-xs text-muted-foreground">
          {new Date(data.shift.startedAt).toLocaleString("he-IL")}
          {data.shift.endedAt && ` — ${new Date(data.shift.endedAt).toLocaleString("he-IL")}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1 bg-amber-950/30 border border-amber-800/40 rounded px-2 py-1 inline-block">
          קריאה בלבד
        </p>
      </div>
      {data.messages.map((msg) => {
        if (msg.type === "system") return <SystemCard key={msg.id} message={msg} />;
        if (msg.type === "broadcast") return (
          <BroadcastCard
            key={msg.id} message={msg}
            currentUserId={userId ?? null}
            isSender={false}
            onAck={() => {}}  // Read-only: no-op
          />
        );
        return (
          <MessageBubble
            key={msg.id} message={msg}
            currentUserId={userId ?? null}
            onReact={() => {}} // Read-only: no-op
            canPin={false}
          />
        );
      })}
      {data.messages.length === 0 && (
        <p className="text-center text-muted-foreground text-sm">אין הודעות בארכיון</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add route in `src/app/routes.tsx`**

Find where other page routes are defined. Add:

```tsx
import { ShiftChatArchive } from "@/features/shift-chat/components/ShiftChatArchive";

// Inside the router definition:
{ path: "/shift-chat/:shiftId", element: <ShiftChatArchive /> },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "archive|Archive"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/routes/shift-chat.ts src/features/shift-chat/components/ShiftChatArchive.tsx src/app/routes.tsx
git commit -m "feat(shift-chat): read-only archive view for completed shifts"
```

---

## Task 15: Integration Tests

**Files:**
- Modify: `server/tests/shift-chat.test.ts`

- [ ] **Step 1: Expand the test file with full coverage**

Replace the content of `server/tests/shift-chat.test.ts` with:

```typescript
const BASE = "http://localhost:3001";
let passed = 0;
let failed = 0;

function ok(label: string) { console.log(`  ✅ PASS: ${label}`); passed++; }
function fail(label: string, detail?: string) { console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ""}`); failed++; }

async function get(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, opts);
}
async function post(path: string, body?: unknown, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
}

// ─── Auth / role gate tests ───────────────────────────────────────────────────

async function testGetRequiresAuth() {
  const res = await get("/api/shift-chat/messages");
  res.status === 401 ? ok("GET requires auth") : fail("GET requires auth", `got ${res.status}`);
}

async function testStudentDenied() {
  const res = await get("/api/shift-chat/messages", {
    headers: { "x-dev-role-override": "student" },
  });
  res.status === 403 ? ok("Student denied GET") : fail("Student denied GET", `got ${res.status}`);
}

async function testGetReturnsShape() {
  const res = await get("/api/shift-chat/messages", {
    headers: { "x-dev-role-override": "technician" },
  });
  if (!res.ok) { fail("GET returns 200", `got ${res.status}`); return; }
  const body = await res.json();
  Array.isArray(body.messages) && "pinnedMessage" in body && Array.isArray(body.typing) && Array.isArray(body.onlineUserIds)
    ? ok("GET returns correct shape")
    : fail("GET shape wrong", JSON.stringify(body));
}

async function testPostRequiresAuth() {
  const res = await post("/api/shift-chat/messages", { body: "hi", type: "regular" });
  res.status === 401 ? ok("POST requires auth") : fail("POST requires auth", `got ${res.status}`);
}

async function testBroadcastBlockedForTech() {
  const res = await post(
    "/api/shift-chat/messages",
    { body: "", type: "broadcast", broadcastKey: "department_close" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 403 ? ok("Technician cannot broadcast") : fail("Broadcast block", `got ${res.status}`);
}

async function testBodyTooLong() {
  const res = await post(
    "/api/shift-chat/messages",
    { body: "x".repeat(1001), type: "regular" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 400 ? ok("Body > 1000 chars rejected") : fail("Body length guard", `got ${res.status}`);
}

async function testAckRequiresAuth() {
  const res = await post("/api/shift-chat/messages/fake/ack", { status: "acknowledged" });
  res.status === 401 ? ok("Ack requires auth") : fail("Ack auth", `got ${res.status}`);
}

async function testAckInvalidStatus() {
  const res = await post(
    "/api/shift-chat/messages/fake/ack",
    { status: "wrong" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 400 ? ok("Invalid ack status rejected") : fail("Ack validation", `got ${res.status}`);
}

async function testPinRequiresSenior() {
  const res = await post("/api/shift-chat/messages/fake/pin", undefined, {
    headers: { "x-dev-role-override": "technician" },
  });
  res.status === 403 ? ok("Technician cannot pin") : fail("Pin RBAC", `got ${res.status}`);
}

async function testPinAllowedForDoctor() {
  // vet role has level 30, senior_technician requirement is level 25 — should pass
  const res = await post("/api/shift-chat/messages/fake/pin", undefined, {
    headers: { "x-dev-role-override": "vet" },
  });
  // Will 404 (message not found) rather than 403 — that's the correct allowed behaviour
  res.status !== 403 ? ok("Doctor allowed to pin (gets 404, not 403)") : fail("Doctor pin allowed", `got ${res.status}`);
}

async function testReactionInvalidEmoji() {
  const res = await post(
    "/api/shift-chat/reactions",
    { messageId: "fake", emoji: "🔥" },
    { headers: { "x-dev-role-override": "technician" } },
  );
  res.status === 400 ? ok("Invalid emoji rejected") : fail("Emoji validation", `got ${res.status}`);
}

async function testTypingUpdatesPresence() {
  const res = await post("/api/shift-chat/typing", undefined, {
    headers: { "x-dev-role-override": "technician" },
  });
  res.ok ? ok("Typing endpoint returns 200") : fail("Typing endpoint", `got ${res.status}`);
}

async function testArchiveRequiresSenior() {
  const res = await get("/api/shift-chat/archive/fake-shift", {
    headers: { "x-dev-role-override": "technician" },
  });
  res.status === 403 ? ok("Technician cannot access archive") : fail("Archive RBAC", `got ${res.status}`);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  console.log("=== Shift Chat Integration Tests ===\n");
  try {
    const health = await get("/api/healthz");
    if (!health.ok) throw new Error(`healthz ${health.status}`);
    console.log("Server reachable ✓\n");
  } catch {
    console.error("Server not reachable — start with: pnpm dev");
    process.exit(1);
  }

  await testGetRequiresAuth();
  await testStudentDenied();
  await testGetReturnsShape();
  await testPostRequiresAuth();
  await testBroadcastBlockedForTech();
  await testBodyTooLong();
  await testAckRequiresAuth();
  await testAckInvalidStatus();
  await testPinRequiresSenior();
  await testPinAllowedForDoctor();
  await testReactionInvalidEmoji();
  await testTypingUpdatesPresence();
  await testArchiveRequiresSenior();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the full test suite**

```bash
npx tsx server/tests/shift-chat.test.ts
```

Expected: all 13 tests pass.

- [ ] **Step 3: Final commit**

```bash
git add server/tests/shift-chat.test.ts
git commit -m "test(shift-chat): full integration test suite — 13 cases"
```

---

## Done

All 15 tasks complete. Verify the end state:

```bash
# Compile check
npx tsc --noEmit

# Run all shift chat tests
npx tsx server/tests/shift-chat.test.ts

# Confirm 3 new tables exist
npx tsx -e "import { db, shiftMessages, shiftMessageAcks, shiftMessageReactions } from './server/db.js'; console.log('tables ok');"
```

Expected: no TypeScript errors, 13/13 tests passing, tables importable.
