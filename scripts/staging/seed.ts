/**
 * Staging-only E2E seed: Clerk test users + vt_users + optional clinical check-ins.
 *
 * Usage:
 *   STAGING_E2E_CONFIRM=yes STAGING_E2E_PASSWORD='...' \
 *   DATABASE_URL=... CLERK_SECRET_KEY=sk_test_... \
 *   tsx scripts/staging/seed.ts
 *
 * Prerequisites: migrations applied on staging DB; sk_test_* Clerk keys only.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import { db, pool, clinics, users, clinicalCheckIns } from "../../server/db.js";
import { runStagingGuard, assertStagingE2ePassword } from "./guard.js";
import { STAGING_PERSONAS, STAGING_E2E_CLINIC_ID, type StagingPersona } from "./personas.js";
import { createClerkStagingUser, findClerkUserByEmail, deleteClerkUser } from "./clerk-api.js";
import { writeManifest, type StagingE2eManifest } from "./manifest.js";
import { and, eq, isNull } from "drizzle-orm";

async function upsertVtUser(params: {
  persona: StagingPersona;
  clerkUserId: string;
}): Promise<string> {
  const vtUserId = `staging-e2e-${params.persona.key}`;
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, params.clerkUserId))
    .limit(1);

  if (existing) {
    await db
      .update(users)
      .set({
        email: params.persona.email,
        name: params.persona.name,
        displayName: params.persona.name,
        role: params.persona.role,
        status: params.persona.status,
        clinicId: STAGING_E2E_CLINIC_ID,
        deletedAt: null,
        deletedBy: null,
      })
      .where(eq(users.id, existing.id));
    return existing.id;
  }

  await db
    .insert(users)
    .values({
      id: vtUserId,
      clinicId: STAGING_E2E_CLINIC_ID,
      clerkId: params.clerkUserId,
      email: params.persona.email,
      name: params.persona.name,
      displayName: params.persona.name,
      role: params.persona.role,
      status: params.persona.status,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        clerkId: params.clerkUserId,
        email: params.persona.email,
        name: params.persona.name,
        displayName: params.persona.name,
        role: params.persona.role,
        status: params.persona.status,
        deletedAt: null,
        deletedBy: null,
      },
    });

  return vtUserId;
}

async function ensureClinicalCheckIn(vtUserId: string, persona: StagingPersona): Promise<void> {
  if (!persona.clinicalCheckIn) return;

  const [open] = await db
    .select({ id: clinicalCheckIns.id })
    .from(clinicalCheckIns)
    .where(
      and(
        eq(clinicalCheckIns.clinicId, STAGING_E2E_CLINIC_ID),
        eq(clinicalCheckIns.userId, vtUserId),
        isNull(clinicalCheckIns.checkedOutAt),
      ),
    )
    .limit(1);

  if (open) return;

  await db.insert(clinicalCheckIns).values({
    id: randomUUID(),
    clinicId: STAGING_E2E_CLINIC_ID,
    userId: vtUserId,
    clinicalRoleAtCheckIn: persona.role === "vet" ? "vet" : "technician",
    operationalRole: persona.role,
  });
}

async function ensureClerkUser(
  persona: StagingPersona,
  password: string,
): Promise<{ clerkUserId: string; created: boolean }> {
  const existing = await findClerkUserByEmail(persona.email);
  if (existing) {
    return { clerkUserId: existing.id, created: false };
  }

  const [firstName, ...rest] = persona.name.split(" ");
  const created = await createClerkStagingUser({
    email: persona.email,
    password,
    firstName: firstName || "Staging",
    lastName: rest.join(" ") || "E2E",
  });
  return { clerkUserId: created.id, created: true };
}

async function main(): Promise<void> {
  runStagingGuard();
  const password = assertStagingE2ePassword();

  console.info("[staging-seed] Ensuring clinic…");
  await db.insert(clinics).values({ id: STAGING_E2E_CLINIC_ID }).onConflictDoNothing();

  const manifestEntries: StagingE2eManifest["personas"] = [];
  const createdClerkIds: string[] = [];

  for (const persona of STAGING_PERSONAS) {
    console.info(`[staging-seed] Persona ${persona.key} (${persona.email})…`);
    const { clerkUserId, created } = await ensureClerkUser(persona, password);
    if (created) createdClerkIds.push(clerkUserId);

    const vtUserId = await upsertVtUser({ persona, clerkUserId });
    await ensureClinicalCheckIn(vtUserId, persona);

    manifestEntries.push({
      key: persona.key,
      email: persona.email,
      clerkUserId,
      vtUserId,
      role: persona.role,
      status: persona.status,
    });
    console.info(`[staging-seed]   clerkId=${clerkUserId} vtUserId=${vtUserId}`);
  }

  writeManifest({
    version: 1,
    clinicId: STAGING_E2E_CLINIC_ID,
    createdAt: new Date().toISOString(),
    personas: manifestEntries,
    codeBlueSessionIds: [],
  });

  console.info("[staging-seed] Done.");
  console.info(`[staging-seed] Manifest: ${manifestEntries.length} personas`);
  if (createdClerkIds.length > 0) {
    console.info(`[staging-seed] Created ${createdClerkIds.length} new Clerk user(s) in staging Clerk app.`);
  }
}

main()
  .catch(async (err) => {
    console.error("[staging-seed] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
