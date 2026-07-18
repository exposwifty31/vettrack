/**
 * R-SH-F1.3 — App-observed signals on the shift-handover artifact.
 *
 * Beyond the manually-logged audit/outbox deltas (R-SH-F1.2), the handover
 * carries SYSTEM-DERIVED observations attributable to the shift window —
 * custody/scan/readiness events the app recorded, not actions a user logged.
 * These are read on their OWN clinic-scoped read path (`vt_scan_logs`), separate
 * from the delta aggregation over `vt_audit_logs` + `vt_event_outbox`.
 *
 * This DB-integration suite asserts:
 *   - seeded system (scan) events INSIDE `[start, end)` surface as observedSignals;
 *   - events OUTSIDE the window are excluded;
 *   - CROSS-CLINIC negative — another clinic's same-looking scan is excluded
 *     (the target-table `clinicId` predicate holds on the observed read path too).
 *
 * Requires DATABASE_URL (e.g. from .env) with migration 177 applied
 * (`vt_shift_handover`). Self-skips when DATABASE_URL is absent so the default
 * `pnpm test` stays green in a DB-less environment.
 * Run: pnpm test -- tests/shift-handover-observed.test.ts
 */
import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  clinics,
  users,
  shiftSessions,
  scanLogs,
  shiftHandover,
} from "../server/db.js";
import { generateShiftHandover } from "../server/lib/shift-handover-generator.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

// Fixed instants — no wall-clock dependence.
const SHIFT_START = new Date("2026-04-14T08:00:00.000Z");
const SHIFT_END = new Date("2026-04-14T16:00:00.000Z");
const IN_WINDOW = new Date("2026-04-14T10:00:00.000Z");
const IN_WINDOW_2 = new Date("2026-04-14T12:30:00.000Z");
const BEFORE_WINDOW = new Date("2026-04-14T07:00:00.000Z");
const AFTER_WINDOW = new Date("2026-04-14T17:00:00.000Z");

let clinicA = "";
let clinicB = "";
let sessionA = "";
let sessionB = "";
let userA = "";
let userB = "";

async function makeClinic(): Promise<{ clinicId: string; userId: string }> {
  const clinicId = `test-shf-obs-${randomUUID()}`;
  const userId = randomUUID();
  await db.insert(clinics).values({ id: clinicId });
  await db.insert(users).values({
    id: userId,
    clinicId,
    clerkId: `clerk_${randomUUID()}`,
    email: `shfobs_${randomUUID()}@example.com`,
    name: "Observed Tester",
    displayName: "Observed Tester",
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

async function seedScan(
  clinicId: string,
  userId: string,
  status: string,
  equipmentId: string,
  at: Date,
): Promise<string> {
  const id = randomUUID();
  await db.insert(scanLogs).values({
    id,
    clinicId,
    equipmentId,
    userId,
    userEmail: "shfobs@example.com",
    status,
    timestamp: at,
  });
  return id;
}

/** Seed the in/out-of-window scan-signal fixture for one clinic. */
async function seedClinicSignals(clinicId: string, userId: string) {
  return {
    scanIn: await seedScan(clinicId, userId, "ok", "eq1", IN_WINDOW),
    scanIn2: await seedScan(clinicId, userId, "blocked", "eq2", IN_WINDOW_2),
    // out-of-window — must be excluded
    scanBefore: await seedScan(clinicId, userId, "ok", "eqBEFORE", BEFORE_WINDOW),
    scanAfter: await seedScan(clinicId, userId, "ok", "eqAFTER", AFTER_WINDOW),
  };
}

async function purge(clinicId: string) {
  await db.delete(shiftHandover).where(eq(shiftHandover.clinicId, clinicId));
  await db.delete(scanLogs).where(eq(scanLogs.clinicId, clinicId));
  await db.delete(shiftSessions).where(eq(shiftSessions.clinicId, clinicId));
  await db.delete(users).where(eq(users.clinicId, clinicId));
  await db.delete(clinics).where(eq(clinics.id, clinicId));
}

describe.skipIf(!DATABASE_URL)("R-SH-F1.3 — shift-handover observed signals", () => {
  let fixtureA: Awaited<ReturnType<typeof seedClinicSignals>>;

  beforeEach(async () => {
    const a = await makeClinic();
    const b = await makeClinic();
    clinicA = a.clinicId;
    userA = a.userId;
    clinicB = b.clinicId;
    userB = b.userId;
    sessionA = await makeSession(clinicA, userA);
    sessionB = await makeSession(clinicB, userB);
    fixtureA = await seedClinicSignals(clinicA, userA);
    // Cross-clinic: same-looking scan events for clinic B in the same window.
    await seedClinicSignals(clinicB, userB);
  });

  afterEach(async () => {
    await purge(clinicA);
    await purge(clinicB);
  });

  it("surfaces seeded in-window system (scan) events as observed signals", async () => {
    const row = await generateShiftHandover(clinicA, sessionA);
    const ids = row.observedSignals.map((s) => s.sourceId).sort();
    expect(ids).toEqual([fixtureA.scanIn, fixtureA.scanIn2].sort());
    // each signal carries a bounded kind + an ISO timestamp
    const byId = new Map(row.observedSignals.map((s) => [s.sourceId, s]));
    expect(byId.get(fixtureA.scanIn)?.kind).toBe("scan:ok");
    expect(byId.get(fixtureA.scanIn2)?.kind).toBe("scan:blocked");
    expect(byId.get(fixtureA.scanIn)?.at).toBe(IN_WINDOW.toISOString());
  });

  it("excludes observed signals outside [start, end)", async () => {
    const row = await generateShiftHandover(clinicA, sessionA);
    const ids = row.observedSignals.map((s) => s.sourceId);
    expect(ids).not.toContain(fixtureA.scanBefore);
    expect(ids).not.toContain(fixtureA.scanAfter);
  });

  it("CROSS-CLINIC — excludes another clinic's same-looking observed events", async () => {
    const rowA = await generateShiftHandover(clinicA, sessionA);
    const idsA = new Set(rowA.observedSignals.map((s) => s.sourceId));
    // only clinic A's two in-window scans surface
    expect(rowA.observedSignals).toHaveLength(2);

    const rowB = await generateShiftHandover(clinicB, sessionB);
    // clinic B's signals must never leak into clinic A's artifact
    for (const s of rowB.observedSignals) {
      expect(idsA.has(s.sourceId)).toBe(false);
    }
  });
});
