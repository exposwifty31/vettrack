/**
 * Remove staging E2E Clerk users, vt_users rows, and related fixtures.
 *
 * Usage:
 *   STAGING_E2E_CONFIRM=yes DATABASE_URL=... CLERK_SECRET_KEY=sk_test_... \
 *   tsx scripts/staging/cleanup.ts
 */
import "dotenv/config";
import { db, pool, users, clinicalCheckIns, codeBlueSessions } from "../../server/db.js";
import { runStagingGuard } from "./guard.js";
import { readManifest, clearManifest } from "./manifest.js";
import { deleteClerkUser, findClerkUserByEmail } from "./clerk-api.js";
import { STAGING_PERSONAS, stagingPersonaEmail } from "./personas.js";
import { eq, inArray, like } from "drizzle-orm";

async function main(): Promise<void> {
  runStagingGuard();

  const manifest = readManifest();
  const clerkIds = new Set<string>();
  const vtIds = new Set<string>();

  if (manifest) {
    for (const p of manifest.personas) {
      clerkIds.add(p.clerkUserId);
      vtIds.add(p.vtUserId);
    }
    if (manifest.codeBlueSessionIds?.length) {
      await db
        .delete(codeBlueSessions)
        .where(inArray(codeBlueSessions.id, manifest.codeBlueSessionIds));
      console.info(
        `[staging-cleanup] Deleted ${manifest.codeBlueSessionIds.length} Code Blue session(s)`,
      );
    }
  }

  if (clerkIds.size === 0) {
    for (const persona of STAGING_PERSONAS) {
      const found = await findClerkUserByEmail(stagingPersonaEmail(persona.key));
      if (found) clerkIds.add(found.id);
    }
    if (clerkIds.size > 0) {
      console.info(
        `[staging-cleanup] Resolved ${clerkIds.size} Clerk user(s) by persona email (no manifest)`,
      );
    }
  }

  for (const persona of STAGING_PERSONAS) {
    vtIds.add(`staging-e2e-${persona.key}`);
  }

  for (const clerkId of clerkIds) {
    await deleteClerkUser(clerkId);
    console.info(`[staging-cleanup] Deleted Clerk user ${clerkId}`);
  }

  const emailMatched = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "staging-e2e-%@vettrack-e2e.example.com"));
  for (const row of emailMatched) {
    vtIds.add(row.id);
  }

  const vtIdList = [...vtIds];
  if (vtIdList.length > 0) {
    await db.delete(clinicalCheckIns).where(inArray(clinicalCheckIns.userId, vtIdList));
    await db.delete(users).where(inArray(users.id, vtIdList));
    console.info(`[staging-cleanup] Deleted ${vtIdList.length} vt_users row(s)`);
  }

  clearManifest();
  console.info("[staging-cleanup] Done.");
}

main()
  .catch((err) => {
    console.error("[staging-cleanup] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
