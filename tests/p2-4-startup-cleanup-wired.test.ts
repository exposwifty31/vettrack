/**
 * P2-4 regression: runStartupCleanup must be called from initSyncEngine
 * so that synced and stale-failed offline rows are eventually cleaned up.
 *
 * Before fix: runStartupCleanup existed in offline-db.ts but had zero
 * call sites — synced rows accumulated in IndexedDB indefinitely.
 */
import { describe, it, expect } from "vitest";

describe("P2-4: runStartupCleanup wired from initSyncEngine", () => {
  it("sync-engine imports runStartupCleanup from offline-db", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/sync-engine.ts", "utf8");

    expect(source).toContain("runStartupCleanup");
    expect(source).toMatch(/import\s*\{[^}]*runStartupCleanup[^}]*\}\s*from\s*["']\.\/offline-db["']/);
  });

  it("initSyncEngine calls runStartupCleanup fire-and-forget", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/sync-engine.ts", "utf8");

    const initStart = source.indexOf("export function initSyncEngine");
    const initFn = source.slice(initStart, source.indexOf("return () => {", initStart));

    // Phase 5: recover processing → hydrate conflicts → cleanup → first replay.
    expect(initFn).toContain("recoverProcessingPendingSync()");
    expect(initFn).toContain("runStartupCleanup(queryClient)");
    expect(initFn).toMatch(/runStartupCleanup\(queryClient\)[\s\S]*processQueue\(\)/);
    const beforeRecovery = source.slice(initStart, source.indexOf("recoverProcessingPendingSync", initStart));
    expect(beforeRecovery).not.toContain("if (isOnline())");
    expect(initFn).toContain(".catch(() => {})");
  });

  it("runStartupCleanup removes synced rows and old dead-letter rows", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/offline-db.ts", "utf8");

    const fn = source.slice(
      source.indexOf("export async function runStartupCleanup"),
      source.indexOf("export async function", source.indexOf("export async function runStartupCleanup") + 1) || source.length,
    );

    // Cleans synced rows
    expect(fn).toContain('"synced"');
    expect(fn).toContain("bulkDelete");
    // Phase 5: optional dead-letter retention only — never auto-delete conflict.
    expect(fn).toContain('"dead"');
    expect(fn).toContain("DEAD_LETTER_RETENTION_MS");
    expect(fn).not.toContain('.equals("failed")');
  });
});
