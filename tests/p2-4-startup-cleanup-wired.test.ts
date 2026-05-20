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

    const initFn = source.slice(
      source.indexOf("export function initSyncEngine"),
      source.indexOf("window.addEventListener", source.indexOf("export function initSyncEngine")),
    );

    // Must call runStartupCleanup with .catch() (fire-and-forget)
    expect(initFn).toContain("runStartupCleanup(queryClient).catch(");
  });

  it("runStartupCleanup removes synced rows and old failed rows", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/offline-db.ts", "utf8");

    const fn = source.slice(
      source.indexOf("export async function runStartupCleanup"),
      source.indexOf("export async function", source.indexOf("export async function runStartupCleanup") + 1) || source.length,
    );

    // Cleans synced rows
    expect(fn).toContain('"synced"');
    expect(fn).toContain("bulkDelete");
    // Cleans old failed rows (7-day threshold)
    expect(fn).toContain('"failed"');
    expect(fn).toContain("7 * 24 * 60 * 60 * 1000");
  });
});
