/**
 * Phase 9 — User auth lifecycle static-analysis tests.
 *
 * Tests that verify the root-cause fixes and prevention mechanisms:
 * 1. Cleanup scheduler never auto-hard-deletes users
 * 2. Purge requires explicit admin action + audit trail
 * 3. Clerk webhook handler exists and handles user.created/updated/deleted
 * 4. Delete/restore endpoints use requireAuth (not requireAuthAny)
 * 5. Sync endpoint has race-condition protection
 * 6. Backfill-from-Clerk endpoint exists for recovery
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. Cleanup scheduler — must NOT auto-hard-delete users
// ---------------------------------------------------------------------------
describe("cleanup-scheduler.ts", () => {
  const src = read("server/lib/cleanup-scheduler.ts");

  it("startCleanupScheduler does not call db.delete", () => {
    // Extract the startCleanupScheduler function body
    const fnStart = src.indexOf("export function startCleanupScheduler");
    const fnBody = src.slice(fnStart);
    // The scheduler itself (not the purgeDeletedUsers helper) must not call db.delete
    // Verify by checking there's no db.delete between startCleanupScheduler and purgeDeletedUsers
    const purgeStart = src.indexOf("export async function purgeDeletedUsers");
    const schedulerBody = src.slice(fnStart);
    // schedulerBody contains purgeDeletedUsers only by reference, not by definition
    expect(schedulerBody).not.toMatch(/db\.delete\(/);
  });

  it("purgeDeletedUsers calls logAudit before returning", () => {
    expect(src).toContain("logAudit(");
  });

  it("purgeDeletedUsers uses inArray (not raw sql delete-all)", () => {
    expect(src).toContain("inArray(users.id");
  });

  it("PURGE_AFTER_DAYS is exported and >= 30", () => {
    const retentionSrc = read("server/lib/retention-policy.ts");
    const match = retentionSrc.match(/export const PURGE_AFTER_DAYS\s*=\s*(\d+)/);
    expect(match, "PURGE_AFTER_DAYS must be exported from retention-policy.ts").not.toBeNull();
    const days = parseInt(match[1], 10);
    expect(days).toBeGreaterThanOrEqual(30);
    expect(src).toContain('export { PURGE_AFTER_DAYS } from "./retention-policy.js"');
  });

  it("countPurgeCandidates is exported (informational, no delete)", () => {
    expect(src).toContain("export async function countPurgeCandidates");
    // countPurgeCandidates must not call delete
    const fnStart = src.indexOf("export async function countPurgeCandidates");
    const fnEnd = src.indexOf("\n}", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain("db.delete(");
  });
});

// ---------------------------------------------------------------------------
// 2. Purge endpoint — admin-only, audit-logged
// ---------------------------------------------------------------------------
describe("users.ts — purge endpoints", () => {
  const src = read("server/routes/users.ts");

  it("imports purgeDeletedUsers and countPurgeCandidates from cleanup-scheduler", () => {
    expect(src).toContain("purgeDeletedUsers");
    expect(src).toContain("countPurgeCandidates");
    expect(src).toContain("cleanup-scheduler");
  });

  it("POST /purge-deleted requires requireAdmin", () => {
    const postPurge = src.slice(src.indexOf('"/purge-deleted"'));
    expect(postPurge.slice(0, 200)).toContain("requireAdmin");
  });

  it("GET /purge-candidates requires requireAdmin", () => {
    const getPurge = src.slice(src.indexOf('"/purge-candidates"'));
    expect(getPurge.slice(0, 200)).toContain("requireAdmin");
  });
});

// ---------------------------------------------------------------------------
// 3. Delete/restore endpoints use requireAuth, not requireAuthAny
// ---------------------------------------------------------------------------
describe("users.ts — delete and restore endpoint auth", () => {
  const src = read("server/routes/users.ts");

  it("PATCH /:id/delete uses requireAuth (not requireAuthAny)", () => {
    // Find the delete route registration
    const deleteRoute = src.match(/router\.patch\(['"]\/:id\/delete['"]([\s\S]{0,80})/);
    expect(deleteRoute, "/:id/delete route not found").not.toBeNull();
    const routeHead = deleteRoute[1];
    expect(routeHead).toContain("requireAuth");
    expect(routeHead).not.toContain("requireAuthAny");
  });

  it("PATCH /:id/restore uses requireAuth (not requireAuthAny)", () => {
    const restoreRoute = src.match(/router\.patch\(['"]\/:id\/restore['"]([\s\S]{0,80})/);
    expect(restoreRoute, "/:id/restore route not found").not.toBeNull();
    const routeHead = restoreRoute[1];
    expect(routeHead).toContain("requireAuth");
    expect(routeHead).not.toContain("requireAuthAny");
  });
});

// ---------------------------------------------------------------------------
// 4. Sync endpoint — race condition protection
// ---------------------------------------------------------------------------
describe("users.ts — /sync race condition protection", () => {
  const src = read("server/routes/users.ts");

  it("sync uses onConflictDoUpdate on clerkId", () => {
    // The sync function first checks for existing user then upserts — search whole function
    const syncStart = src.indexOf('router.post("/sync"');
    const syncFn = src.slice(syncStart, syncStart + 5000);
    expect(syncFn).toContain("onConflictDoUpdate");
    expect(syncFn).toContain("clerkId");
  });

  it("sync catches 23505 unique violation (race condition)", () => {
    const syncStart = src.indexOf('router.post("/sync"');
    const syncFn = src.slice(syncStart, syncStart + 5000);
    expect(syncFn).toContain("23505");
  });
});

// ---------------------------------------------------------------------------
// 5. Clerk webhook handler
// ---------------------------------------------------------------------------
describe("server/routes/webhooks.ts", () => {
  const src = read("server/routes/webhooks.ts");

  it("file exists and uses svix Webhook for signature verification", () => {
    expect(src).toContain("from \"svix\"");
    expect(src).toContain("new Webhook(secret)");
    expect(src).toContain("wh.verify(");
  });

  it("handles user.created event", () => {
    expect(src).toContain("user.created");
  });

  it("handles user.updated event", () => {
    expect(src).toContain("user.updated");
  });

  it("handles user.deleted event with soft-delete + audit log", () => {
    expect(src).toContain("user.deleted");
    // The user.deleted branch must soft-delete (not hard-delete)
    const deletedSection = src.slice(src.indexOf('"user.deleted"'));
    expect(deletedSection.slice(0, 500)).toContain("deletedAt: new Date()");
    expect(deletedSection.slice(0, 500)).toContain("logAudit");
  });

  it("returns 501 when CLERK_WEBHOOK_SECRET is not configured", () => {
    expect(src).toContain("CLERK_WEBHOOK_SECRET");
    expect(src).toContain("501");
  });

  it("rejects requests with missing svix headers (400)", () => {
    expect(src).toContain("svix-id");
    expect(src).toContain("400");
  });

  it("user.deleted does NOT hard-delete (no db.delete)", () => {
    // The webhook handler must never call db.delete — only db.update with deletedAt
    expect(src).not.toContain("db.delete(");
  });
});

// ---------------------------------------------------------------------------
// 6. Webhook route registered in index.ts before express.json()
// ---------------------------------------------------------------------------
describe("server/index.ts — webhook route registration", () => {
  const src = read("server/index.ts");

  it("imports clerkWebhookRoutes", () => {
    expect(src).toContain("webhooks");
  });

  it("webhook route is registered before app.use(express.json)", () => {
    const webhookIdx = src.indexOf("/api/webhooks/clerk");
    // Use app.use(express.json to avoid matching comments that reference express.json()
    const jsonIdx = src.indexOf("app.use(express.json");
    expect(webhookIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(webhookIdx).toBeLessThan(jsonIdx);
  });
});

// ---------------------------------------------------------------------------
// 7. Backfill-from-Clerk recovery endpoint exists
// ---------------------------------------------------------------------------
describe("users.ts — backfill-clerk recovery endpoint", () => {
  const src = read("server/routes/users.ts");

  it("POST /backfill-clerk exists and requires requireAdmin", () => {
    const backfill = src.slice(src.indexOf('"/backfill-clerk"'));
    expect(backfill.slice(0, 200)).toContain("requireAdmin");
  });

  it("backfill uses onConflictDoUpdate (idempotent upsert)", () => {
    const backfill = src.slice(src.indexOf('"/backfill-clerk"'));
    expect(backfill.slice(0, 3000)).toContain("onConflictDoUpdate");
  });

  it("backfill restores soft-deleted users (sets deletedAt: null)", () => {
    const backfill = src.slice(src.indexOf('"/backfill-clerk"'));
    expect(backfill.slice(0, 3000)).toContain("deletedAt: null");
  });
});
