/**
 * G3C-1 — reviewer/demo account + synthetic live-shift seed.
 *
 * Verifies `scripts/seed-reviewer-demo.ts` produces a least-privilege demo
 * account that clears BootstrapGate (role >= student) AND resolves an open
 * clinical shift via the real `resolveAuthority` path — the same mechanism
 * shift-gated RN screens depend on — so a fresh App Store reviewer session
 * sees populated screens instead of empty lists.
 *
 * Requires DATABASE_URL + migrations applied; skips cleanly otherwise.
 *
 * Run: DATABASE_URL=... pnpm exec vitest run tests/seed-reviewer-demo.integration.test.ts
 *   or: pnpm test:db-integration (registered in vitest.db-integration.config.ts)
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let probePool: Pool | null = null;
let dbReachable = false;

if (DATABASE_URL) {
  probePool = new Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000, max: 2 });
  try {
    await probePool.query("SELECT 1");
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
}

describe.skipIf(!dbReachable)("seed-reviewer-demo integration", () => {
  const CLINIC_ID = "reviewer-demo-clinic-test";
  const CLERK_ID = "reviewer-demo-clerk-test";

  const OVERRIDE_CLINIC_ID = "reviewer-override-clinic-test";
  const OTHER_CLINIC_ID = "reviewer-demo-other-clinic-test";
  const STALENESS_CLINIC_ID = "reviewer-demo-staleness-clinic-test";

  afterAll(async () => {
    // Best-effort cleanup — leaves no cruft in the local dev DB across runs.
    // Deletion order respects FK dependencies (children before the clinic).
    for (const clinicId of [CLINIC_ID, OVERRIDE_CLINIC_ID, OTHER_CLINIC_ID, STALENESS_CLINIC_ID]) {
      try {
        await probePool?.query(`DELETE FROM vt_appointments WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_equipment WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_docks WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_rooms WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_folders WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_shifts WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_users WHERE clinic_id = $1`, [clinicId]);
        await probePool?.query(`DELETE FROM vt_clinics WHERE id = $1`, [clinicId]);
      } catch (err) {
        console.warn(`[seed-reviewer-demo.integration.test] cleanup failed for ${clinicId}`, err);
      }
    }
    await probePool?.end();
  });

  it("seeds a technician-role user with an open shift and non-empty clinic data", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");
    const { db, users, equipment, rooms, docks, appointments } = await import("../server/db.js");
    const { resolveAuthority } = await import("../server/lib/authority.js");

    const result = await seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID });

    // 1. User row: least-privilege technician, active, scoped to the demo clinic.
    const [userRow] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);
    if (!userRow) {
      throw new Error(`Expected seedReviewerDemo to have created a user row for id ${result.userId}`);
    }
    expect(userRow.role).toBe("technician");
    expect(userRow.status).toBe("active");
    expect(userRow.clinicId).toBe(CLINIC_ID);

    // 2. Authority resolves an open shift — the real gate that decides whether
    //    shift-gated screens render populated vs empty.
    const authority = await resolveAuthority({
      authUser: { id: result.userId, name: userRow.displayName, role: userRow.role },
      clinicId: CLINIC_ID,
    });
    expect(authority.effectiveClinicalRole).toBe("technician");
    expect(authority.source).toBe("shift");

    // 3. Clinic data non-empty for Grade-A/B screens.
    const eqRows = await db.select().from(equipment).where(eq(equipment.clinicId, CLINIC_ID));
    expect(eqRows.length).toBeGreaterThan(0);

    const roomRows = await db.select().from(rooms).where(eq(rooms.clinicId, CLINIC_ID));
    expect(roomRows.length).toBeGreaterThan(0);

    const dockRows = await db.select().from(docks).where(eq(docks.clinicId, CLINIC_ID));
    expect(dockRows.length).toBeGreaterThan(0);

    const taskRows = await db.select().from(appointments).where(eq(appointments.clinicId, CLINIC_ID));
    expect(taskRows.length).toBeGreaterThan(0);
  });

  it("is idempotent — re-running does not error and keeps role/status authoritative", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");
    const { db, users } = await import("../server/db.js");

    await expect(seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID })).resolves.toBeTruthy();

    const [userRow] = await db.select().from(users).where(eq(users.clerkId, CLERK_ID)).limit(1);
    expect(userRow?.role).toBe("technician");
    expect(userRow?.status).toBe("active");
  });

  // Regression for the G3C-1 database-reviewer HIGH finding: the user `id`
  // must be derived from `clerkId` (the onConflictDoUpdate arbiter), not
  // `clinicId` — otherwise re-running with a corrected/different clerkId for
  // the same demo clinic (e.g. the owner fixes a typo'd Clerk user ID) falls
  // through the ON CONFLICT arbiter and crashes on the vt_users primary key.
  // Reproduced directly via SQL against this same local DB before the fix
  // (duplicate key value violates unique constraint "vt_users_pkey").
  it("re-running with a different clerkId for the same clinic does not collide on the users PK", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");
    const { db, users } = await import("../server/db.js");

    // Self-contained: seed the original clerkId here rather than relying on
    // an earlier test in this file having already created it (test order
    // should never be load-bearing).
    await seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID });

    const otherClerkId = `${CLERK_ID}-corrected`;
    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: otherClerkId }),
    ).resolves.toBeTruthy();

    const rows = await db.select().from(users).where(eq(users.clinicId, CLINIC_ID));
    const clerkIds = rows.map((r) => r.clerkId);
    expect(clerkIds).toContain(CLERK_ID);
    expect(clerkIds).toContain(otherClerkId);
  });

  // Regression for the G3C-1 database-reviewer HIGH finding: nothing stopped
  // a typo'd/stale REVIEWER_DEMO_CLINIC_ID from silently seeding a fake
  // technician + always-on-shift roster + equipment into a REAL clinic (the
  // clinic insert is onConflictDoNothing, so an existing real clinicId would
  // not error — just get polluted).
  it("refuses to seed a clinicId that doesn't look like a demo clinic", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");

    await expect(
      seedReviewerDemo({ clinicId: "some-real-production-clinic", clerkId: "irrelevant" }),
    ).rejects.toThrow(/doesn't look like a demo clinic/);
  });

  it("allows a non-demo-named clinicId when explicitly overridden", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");

    await expect(
      seedReviewerDemo({
        clinicId: OVERRIDE_CLINIC_ID,
        clerkId: "reviewer-override-clerk-test",
        allowAnyClinicId: true,
      }),
    ).resolves.toBeTruthy();
  });

  // Regression for CodeRabbit PR #175 Major finding #1: `users.clerkId` is
  // globally unique, so a blind onConflictDoUpdate on clerkId would hijack
  // an EXISTING operator's account (wrong clinic, real role) into the demo
  // clinic and downgrade it to technician/active if the seed is ever run
  // with a clerkId that collides with a real user. The seed must read the
  // existing row by clerkId first and refuse to write when that row is
  // already assigned to a DIFFERENT clinic.
  it("refuses to hijack an existing user whose clerkId is already assigned to a different clinic", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");
    const { db, clinics, users } = await import("../server/db.js");

    const hijackClerkId = "reviewer-demo-hijack-clerk-test";
    await db.insert(clinics).values({ id: OTHER_CLINIC_ID }).onConflictDoNothing();
    await db
      .insert(users)
      .values({
        id: "reviewer-demo-existing-operator-test",
        clinicId: OTHER_CLINIC_ID,
        clerkId: hijackClerkId,
        email: "real-operator@example.com",
        name: "Real Operator",
        displayName: "Real Operator",
        role: "vet",
        status: "active",
      })
      .onConflictDoNothing();

    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: hijackClerkId }),
    ).rejects.toThrow(/already assigned/);

    // The real operator's row must be untouched — not reassigned, not
    // downgraded.
    const [row] = await db.select().from(users).where(eq(users.clerkId, hijackClerkId)).limit(1);
    expect(row?.clinicId).toBe(OTHER_CLINIC_ID);
    expect(row?.role).toBe("vet");
    expect(row?.status).toBe("active");
  });

  // Regression for CodeRabbit PR #175 Major finding #2: the deterministic
  // shift rows used onConflictDoNothing, so a later run with a different
  // `displayName` updated the user row but left the roster `employeeName`
  // stale — desyncing the roster-name match resolveAuthority relies on.
  it("updates the roster employeeName when displayName changes on a later run (no stale shift rows)", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");
    const { db, shifts } = await import("../server/db.js");

    const clerkId = "reviewer-demo-staleness-clerk-test";
    await seedReviewerDemo({
      clinicId: STALENESS_CLINIC_ID,
      clerkId,
      displayName: "Original Demo Name",
      shiftSpanDays: 2,
    });
    await seedReviewerDemo({
      clinicId: STALENESS_CLINIC_ID,
      clerkId,
      displayName: "Updated Demo Name",
      shiftSpanDays: 2,
    });

    const rows = await db.select().from(shifts).where(eq(shifts.clinicId, STALENESS_CLINIC_ID));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.employeeName).toBe("Updated Demo Name");
    }
  });

  // Regression for CodeRabbit PR #175 finding #3: shiftSpanDays must be
  // bounded — an unvalidated Infinity would loop forever building shiftRows.
  // Infinity itself is deliberately NOT exercised here (it would hang the
  // test process pre-fix); Number.isSafeInteger(Infinity) === false gives
  // the same rejection path as the finite cases below without the risk.
  it("rejects a non-positive shiftSpanDays", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");

    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID, shiftSpanDays: 0 }),
    ).rejects.toThrow(/shiftSpanDays/);
    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID, shiftSpanDays: -3 }),
    ).rejects.toThrow(/shiftSpanDays/);
  });

  it("rejects a non-integer or unsafe shiftSpanDays", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");

    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID, shiftSpanDays: 1.5 }),
    ).rejects.toThrow(/shiftSpanDays/);
    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID, shiftSpanDays: NaN }),
    ).rejects.toThrow(/shiftSpanDays/);
  });

  it("rejects a shiftSpanDays above the documented upper bound, including the received value in the error", async () => {
    const { seedReviewerDemo } = await import("../scripts/seed-reviewer-demo.js");

    await expect(
      seedReviewerDemo({ clinicId: CLINIC_ID, clerkId: CLERK_ID, shiftSpanDays: 10_000 }),
    ).rejects.toThrow(/shiftSpanDays.*10000/s);
  });
});
