/**
 * Shift-chat roster-window regression (BUG-001 root cause, Phase 0).
 *
 * The bug: chat scoped its conversation to the open `vt_shift_sessions` row,
 * but that clock-in table is orphaned — one stale never-ended row kept a
 * weeks-old transcript alive across three "fixes" that only patched the
 * client. This test seeds exactly that pathology and asserts the server now
 * derives the session from the roster window instead.
 *
 * Requires: DATABASE_URL (e.g. from .env), migrations applied (including
 * `159_shift_messages_drop_session_fk.sql` — window ids have no session row).
 *
 * Run: pnpm exec tsx tests/shift-chat-window.integration.test.ts
 */
import "dotenv/config";
import assert from "node:assert";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️  shift-chat window tests skipped (DATABASE_URL not set)");
    process.exit(0);
  }

  const { db, pool, clinics, users, shifts, shiftSessions, shiftMessages } = await import(
    "../server/db.js"
  );
  const { getCurrentShiftWindow, windowMessagesWhere } = await import(
    "../server/lib/shift-chat-window.js"
  );
  const { isWindowSessionId } = await import("../server/lib/shift-window.js");

  const clinicId = `test-p0-${randomUUID()}`;
  const userId = randomUUID();
  const staleSessionId = randomUUID();

  // Fixed instants — no wall-clock dependence.
  const onShiftNow = new Date(2026, 0, 15, 10, 0, 0); // inside 07:00–15:00
  const eveningNow = new Date(2026, 0, 15, 16, 0, 0); // inside 15:00–23:00
  const offShiftNow = new Date(2026, 0, 16, 4, 0, 0); // no roster window
  const threeWeeksAgo = new Date(2025, 11, 25, 9, 0, 0);

  async function purge() {
    await db.delete(shiftMessages).where(eq(shiftMessages.clinicId, clinicId));
    await db.delete(shiftSessions).where(eq(shiftSessions.clinicId, clinicId));
    await db.delete(shifts).where(eq(shifts.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  }

  try {
    await db.insert(clinics).values({ id: clinicId });
    await db.insert(users).values({
      id: userId,
      clinicId,
      clerkId: `clerk_${randomUUID()}`,
      email: `p0_${randomUUID()}@example.com`,
      name: "Chat Tester",
      displayName: "Chat Tester",
      role: "technician",
    });
    await db.insert(shifts).values([
      {
        id: randomUUID(),
        clinicId,
        date: "2026-01-15",
        startTime: "07:00:00",
        endTime: "15:00:00",
        employeeName: "Chat Tester",
        role: "technician",
      },
      {
        id: randomUUID(),
        clinicId,
        date: "2026-01-15",
        startTime: "15:00:00",
        endTime: "23:00:00",
        employeeName: "Chat Tester",
        role: "technician",
      },
    ]);

    // The pathology: a never-ended legacy session with a weeks-old transcript.
    await db.insert(shiftSessions).values({
      id: staleSessionId,
      clinicId,
      startedAt: threeWeeksAgo,
      endedAt: null,
      startedByUserId: userId,
    });
    await db.insert(shiftMessages).values([
      {
        id: randomUUID(),
        shiftSessionId: staleSessionId,
        clinicId,
        senderId: userId,
        senderName: "Chat Tester",
        senderRole: "technician",
        body: "three weeks old",
        type: "regular",
        createdAt: threeWeeksAgo,
      },
    ]);

    const input = {
      clinicId,
      userId,
      userName: "Chat Tester",
      fallbackRole: "technician" as const,
    };

    // 1. Session is roster-derived — never the stale never-ended row.
    const window = await getCurrentShiftWindow({ ...input, now: onShiftNow });
    assert.ok(window, "expected an active roster window at 10:00");
    assert.ok(isWindowSessionId(window.id), `expected a win: id, got ${window.id}`);
    assert.strictEqual(window.id, `win:${clinicId}:2026-01-15:07:00:00`);
    assert.notStrictEqual(window.id, staleSessionId);

    // 2. Window-scoped reads exclude the three-week-old transcript.
    const inWindowId = randomUUID();
    await db.insert(shiftMessages).values({
      id: inWindowId,
      shiftSessionId: window.id, // synthetic id — requires migration 159 (FK dropped)
      clinicId,
      senderId: userId,
      senderName: "Chat Tester",
      senderRole: "technician",
      body: "current window",
      type: "regular",
      createdAt: new Date(2026, 0, 15, 9, 30, 0),
    });
    const visible = await db
      .select({ id: shiftMessages.id })
      .from(shiftMessages)
      .where(windowMessagesWhere(clinicId, window));
    assert.deepStrictEqual(
      visible.map((m) => m.id),
      [inWindowId],
      "window reads must contain only in-window messages",
    );

    // 3. Rollover: the next roster window produces a different session id.
    const evening = await getCurrentShiftWindow({ ...input, now: eveningNow });
    assert.ok(evening, "expected the evening window at 16:00");
    assert.strictEqual(evening.id, `win:${clinicId}:2026-01-15:15:00:00`);
    assert.notStrictEqual(evening.id, window.id);

    // 4. Off-window → null (panel empties, POST 409s) despite the stale session.
    const offShift = await getCurrentShiftWindow({ ...input, now: offShiftNow });
    assert.strictEqual(offShift, null, "no roster window ⇒ no chat session");

    // 5. A user absent from the roster gets no session either.
    const offRoster = await getCurrentShiftWindow({
      clinicId,
      userId: randomUUID(),
      userName: "Nobody OffRoster",
      fallbackRole: "technician" as const,
      now: onShiftNow,
    });
    assert.strictEqual(offRoster, null, "off-roster user ⇒ no chat session");

    console.log("✅ shift-chat roster-window regression: all assertions passed");
  } finally {
    await purge();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ shift-chat window regression failed:", err);
  process.exit(1);
});
