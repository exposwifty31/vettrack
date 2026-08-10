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

  afterAll(async () => {
    // Best-effort cleanup — leaves no cruft in the local dev DB across runs.
    // Deletion order respects FK dependencies (children before the clinic).
    for (const clinicId of [CLINIC_ID, OVERRIDE_CLINIC_ID]) {
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
    expect(userRow?.role).toBe("technician");
    expect(userRow?.status).toBe("active");
    expect(userRow?.clinicId).toBe(CLINIC_ID);

    // 2. Authority resolves an open shift — the real gate that decides whether
    //    shift-gated screens render populated vs empty.
    const authority = await resolveAuthority({
      authUser: { id: result.userId, name: userRow!.displayName, role: userRow!.role },
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
});
