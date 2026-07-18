/**
 * R-SH-F1.2 — Shift-handover delta generator (all 4 delta types) at shift end.
 *
 * `generateShiftHandover(clinicId, shiftSessionId, opts?)` aggregates the
 * shift-window deltas from `vt_audit_logs` + `vt_event_outbox` over the shift
 * window `[start, end)` into the four locked delta dimensions (custody /
 * task-state / alerts / dispenses) + an open-items list, and persists them to
 * `vt_shift_handover`.
 *
 * This DB-integration suite asserts:
 *   - a seeded shift lists EXACTLY the seeded in-window deltas + open items;
 *   - deltas outside `[start, end)` are excluded;
 *   - CROSS-CLINIC negative — another clinic's same-looking events are excluded
 *     (the target-table `clinicId` predicate holds on every read);
 *   - IDEMPOTENT per `shiftSessionId` — the no-opts (scheduler) path returns the
 *     PERSISTED current revision unchanged (same `generatedAt`, no duplicate
 *     deltas, still one row), else inserts `revision = 1`;
 *   - `{ regenerate: true }` inserts `max(revision)+1` preserving prior revisions.
 *
 * Requires DATABASE_URL (e.g. from .env) with migration 177 applied
 * (`vt_shift_handover`). Self-skips when DATABASE_URL is absent so the default
 * `pnpm test` stays green in a DB-less environment.
 * Run: pnpm test -- tests/shift-handover-generator.test.ts
 */
import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  clinics,
  users,
  shiftSessions,
  auditLogs,
  eventOutbox,
  shiftHandover,
} from "../server/db.js";
import { generateShiftHandover } from "../server/lib/shift-handover-generator.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Fixed instants — no wall-clock dependence.
const SHIFT_START = new Date("2026-03-10T08:00:00.000Z");
const SHIFT_END = new Date("2026-03-10T16:00:00.000Z");
const IN_WINDOW = new Date("2026-03-10T10:00:00.000Z");
const BEFORE_WINDOW = new Date("2026-03-10T07:00:00.000Z");
const AFTER_WINDOW = new Date("2026-03-10T17:00:00.000Z"); // == SHIFT_END is exclusive; after is well past

let clinicA = "";
let clinicB = "";
let sessionA = "";
let sessionB = "";
let userA = "";
let userB = "";

async function makeClinic(): Promise<{ clinicId: string; userId: string }> {
  const clinicId = `test-shf-${randomUUID()}`;
  const userId = randomUUID();
  await db.insert(clinics).values({ id: clinicId });
  await db.insert(users).values({
    id: userId,
    clinicId,
    clerkId: `clerk_${randomUUID()}`,
    email: `shf_${randomUUID()}@example.com`,
    name: "Handover Tester",
    displayName: "Handover Tester",
  });
  return { clinicId, userId };
}

async function makeSession(clinicId: string, userId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(shiftSessions).values({
    id,
    clinicId,
    startedAt: SHIFT_START,
    endedAt: SHIFT_END,
    startedByUserId: userId,
  });
  return id;
}

async function seedAudit(
  clinicId: string,
  userId: string,
  actionType: string,
  targetId: string,
  at: Date,
): Promise<string> {
  const id = randomUUID();
  await db.insert(auditLogs).values({
    id,
    clinicId,
    actionType,
    performedBy: userId,
    performedByEmail: "shf@example.com",
    targetId,
    targetType: "equipment",
    timestamp: at,
  });
  return id;
}

async function seedOutbox(clinicId: string, type: string, at: Date): Promise<string> {
  const [row] = await db
    .insert(eventOutbox)
    .values({ clinicId, type, payload: {}, occurredAt: at })
    .returning({ id: eventOutbox.id });
  return String(row!.id);
}

/** Seed the FULL in/out-of-window + cross-clinic delta fixture for one clinic. */
async function seedClinicDeltas(clinicId: string, userId: string) {
  return {
    custodyAudit: await seedAudit(clinicId, userId, "equipment_checked_out", "eq1", IN_WINDOW),
    custodyOutbox: await seedOutbox(clinicId, "EQUIPMENT_CUSTODY_STATE_CHANGED", IN_WINDOW),
    taskStarted: await seedAudit(clinicId, userId, "task_started", "task1", IN_WINDOW),
    taskCompleted: await seedAudit(clinicId, userId, "task_completed", "task2", IN_WINDOW),
    alertCreated: await seedAudit(clinicId, userId, "whatsapp_alert_created", "alert1", IN_WINDOW),
    dispense: await seedAudit(clinicId, userId, "inventory_dispensed", "disp1", IN_WINDOW),
    // out-of-window — must be excluded
    beforeTask: await seedAudit(clinicId, userId, "task_created", "taskBEFORE", BEFORE_WINDOW),
    afterCustody: await seedAudit(clinicId, userId, "equipment_returned", "eqAFTER", AFTER_WINDOW),
  };
}

async function purge(clinicId: string) {
  await db.delete(shiftHandover).where(eq(shiftHandover.clinicId, clinicId));
  await db.delete(eventOutbox).where(eq(eventOutbox.clinicId, clinicId));
  // vt_audit_logs is append-only (DO INSTEAD NOTHING delete rule); disable it
  // briefly to purge this test's own seeded rows, then restore it. Its clinic
  // FK is RESTRICT, so the clinic can't be dropped while audit rows survive.
  await db.execute(sql`ALTER TABLE vt_audit_logs DISABLE RULE no_delete_audit_logs`);
  try {
    await db.delete(auditLogs).where(eq(auditLogs.clinicId, clinicId));
  } finally {
    await db.execute(sql`ALTER TABLE vt_audit_logs ENABLE RULE no_delete_audit_logs`);
  }
  await db.delete(shiftSessions).where(eq(shiftSessions.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

describe.skipIf(!DATABASE_URL)("R-SH-F1.2 — shift-handover delta generator", () => {
  let fixtureA: Awaited<ReturnType<typeof seedClinicDeltas>>;

  beforeEach(async () => {
    const a = await makeClinic();
    const b = await makeClinic();
    clinicA = a.clinicId;
    userA = a.userId;
    clinicB = b.clinicId;
    userB = b.userId;
    sessionA = await makeSession(clinicA, userA);
    sessionB = await makeSession(clinicB, userB);
    fixtureA = await seedClinicDeltas(clinicA, userA);
    // Cross-clinic: same-looking events for clinic B in the same window.
    await seedClinicDeltas(clinicB, userB);
  });

  afterEach(async () => {
    await purge(clinicA);
    await purge(clinicB);
  });

  it("lists EXACTLY the seeded in-window deltas across all 4 types", async () => {
    const row = await generateShiftHandover(clinicA, sessionA);

    const custodyIds = row.deltas.custody.map((d) => d.sourceId).sort();
    expect(custodyIds).toEqual([fixtureA.custodyAudit, fixtureA.custodyOutbox].sort());

    const taskIds = row.deltas.taskState.map((d) => d.sourceId).sort();
    expect(taskIds).toEqual([fixtureA.taskStarted, fixtureA.taskCompleted].sort());

    expect(row.deltas.alerts.map((d) => d.sourceId)).toEqual([fixtureA.alertCreated]);
    expect(row.deltas.dispenses.map((d) => d.sourceId)).toEqual([fixtureA.dispense]);
  });

  it("excludes deltas outside [start, end)", async () => {
    const row = await generateShiftHandover(clinicA, sessionA);
    const allIds = [
      ...row.deltas.custody,
      ...row.deltas.taskState,
      ...row.deltas.alerts,
      ...row.deltas.dispenses,
    ].map((d) => d.sourceId);
    expect(allIds).not.toContain(fixtureA.beforeTask);
    expect(allIds).not.toContain(fixtureA.afterCustody);
  });

  it("derives open items for non-terminal tasks/alerts only", async () => {
    const row = await generateShiftHandover(clinicA, sessionA);
    const openTargets = row.openItems.map((o) => o.id).sort();
    // task1 (started, no terminal) + alert1 (created, unresolved) are open;
    // task2 (completed) is terminal → not open; custody/dispense are not open-state.
    expect(openTargets).toEqual(["alert1", "task1"]);
  });

  it("CROSS-CLINIC — excludes another clinic's same-looking events", async () => {
    const row = await generateShiftHandover(clinicA, sessionA);
    const allIds = new Set(
      [
        ...row.deltas.custody,
        ...row.deltas.taskState,
        ...row.deltas.alerts,
        ...row.deltas.dispenses,
      ].map((d) => d.sourceId),
    );
    // Clinic B's rows must never leak in — assert counts are the clinic-A-only totals.
    expect(row.deltas.custody).toHaveLength(2);
    expect(row.deltas.taskState).toHaveLength(2);
    expect(row.deltas.alerts).toHaveLength(1);
    expect(row.deltas.dispenses).toHaveLength(1);
    // and every id resolves to a clinic-A audit/outbox row
    const bRow = await generateShiftHandover(clinicB, sessionB);
    for (const d of [
      ...bRow.deltas.custody,
      ...bRow.deltas.taskState,
      ...bRow.deltas.alerts,
      ...bRow.deltas.dispenses,
    ]) {
      expect(allIds.has(d.sourceId)).toBe(false);
    }
  });

  it("is IDEMPOTENT — retry returns the persisted current revision unchanged", async () => {
    const first = await generateShiftHandover(clinicA, sessionA);
    expect(first.revision).toBe(1);

    const retry = await generateShiftHandover(clinicA, sessionA);
    expect(retry.id).toBe(first.id);
    expect(retry.revision).toBe(1);
    expect(retry.generatedAt.getTime()).toBe(first.generatedAt.getTime());
    // no duplicate deltas — the persisted snapshot is returned verbatim
    expect(retry.deltas).toEqual(first.deltas);

    const rows = await db
      .select({ id: shiftHandover.id })
      .from(shiftHandover)
      .where(
        and(eq(shiftHandover.clinicId, clinicA), eq(shiftHandover.shiftSessionId, sessionA)),
      );
    expect(rows).toHaveLength(1);
  });

  it("{ regenerate: true } inserts max(revision)+1 preserving priors", async () => {
    const first = await generateShiftHandover(clinicA, sessionA);
    const regen = await generateShiftHandover(clinicA, sessionA, { regenerate: true });

    expect(regen.revision).toBe(first.revision + 1);
    expect(regen.id).not.toBe(first.id);

    const rows = await db
      .select({ id: shiftHandover.id, revision: shiftHandover.revision })
      .from(shiftHandover)
      .where(
        and(eq(shiftHandover.clinicId, clinicA), eq(shiftHandover.shiftSessionId, sessionA)),
      );
    expect(rows.map((r) => r.revision).sort()).toEqual([1, 2]);

    // a subsequent no-opts retry now returns the NEW current revision (2)
    const retry = await generateShiftHandover(clinicA, sessionA);
    expect(retry.revision).toBe(2);
    expect(retry.id).toBe(regen.id);
  });
});
