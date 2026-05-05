/**
 * Idempotent dev seed: ensures the minimum fixtures required for local development
 * and equipment E2E testing are present.
 *
 * Creates (using ON CONFLICT DO NOTHING):
 *   - clinic   : dev-clinic-default
 *   - user     : dev-admin-001  (admin, email admin@vettrack.dev)
 *   - equipment: eq1            (available, status "ok")
 *
 * Safe to run multiple times. Does not overwrite existing data.
 *
 * Prerequisites: DATABASE_URL env var set, migrations applied.
 *
 * Usage:
 *   pnpm seed:dev:e2e
 *   tsx scripts/seed-dev.ts
 */
import "dotenv/config";
import { db, pool, clinics, users, equipment } from "../server/db.js";

const CLINIC_ID = process.env.DEV_DEFAULT_CLINIC_ID?.trim() || "dev-clinic-default";
const USER_ID = "dev-admin-001";
const EQUIPMENT_E2E_ID = "eq1";

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!dbUrl) {
    console.error("[seed-dev] DATABASE_URL or POSTGRES_URL is required.");
    process.exit(1);
  }

  console.info(`[seed-dev] Starting idempotent dev seed (clinicId=${CLINIC_ID})…`);

  // 1. Clinic
  await db
    .insert(clinics)
    .values({ id: CLINIC_ID })
    .onConflictDoNothing();

  // 2. Dev admin user
  await db
    .insert(users)
    .values({
      id: USER_ID,
      clinicId: CLINIC_ID,
      clerkId: USER_ID,
      email: "admin@vettrack.dev",
      name: "Dev Admin",
      displayName: "Dev Admin",
      role: "admin",
      status: "active",
    })
    .onConflictDoNothing();

  // 3. Equipment "eq1" — fixed ID for E2E / manual verification
  //    status="ok", no checkout fields set → starts available
  await db
    .insert(equipment)
    .values({
      id: EQUIPMENT_E2E_ID,
      clinicId: CLINIC_ID,
      name: "E2E Test Equipment",
      status: "ok",
      checkedOutById: null,
      checkedOutByEmail: null,
      checkedOutAt: null,
      checkedOutLocation: null,
    })
    .onConflictDoNothing();

  console.info("[seed-dev] Done.");
  console.info(`  clinic    : ${CLINIC_ID}`);
  console.info(`  user      : ${USER_ID} (admin@vettrack.dev)`);
  console.info(`  equipment : ${EQUIPMENT_E2E_ID} (E2E Test Equipment, available)`);
}

main()
  .catch((err) => {
    console.error("[seed-dev] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
